/**
 * Who else is here, and where their pointer is.
 *
 * Two mechanisms, because they have different shapes. *Who is here* is presence:
 * it survives a reconnect, it is what tells you someone joined, and it changes
 * rarely. *Where the pointer is* is broadcast: it changes twenty times a second
 * and nobody needs it to survive anything, so it is never stored anywhere — §4
 * keeps it off the database entirely for exactly that reason.
 *
 * Positions travel in **board coordinates**, not screen ones. Each client knows
 * its own camera; sending screen points would put everyone else's cursor in the
 * wrong place the moment anyone panned or zoomed.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";

import { getSupabase } from "../supabase/client";

export interface Peer {
  userId: string;
  name: string;
  color: string;
  /** Board coordinates, or null when they have not moved yet. */
  at: { x: number; y: number } | null;
  /** The thing they have the editor open on, by entity id, or null. */
  editing: string | null;
}

export interface BoardPresence {
  /** A stable array for `useSyncExternalStore`. */
  peers(): Peer[];
  subscribe(listener: () => void): () => void;
  /** Pointer position in board coordinates. Throttled here, not by the caller. */
  move(x: number, y: number): void;
  /**
   * A thing in motion, in board coordinates. Ephemeral: §4 keeps a drag off the
   * database entirely, so the others see it move at 20Hz and nothing is written
   * until whoever is dragging lets go.
   */
  moveThing(id: string, x: number, y: number): void;
  /** Where other people are currently holding things, which is not where they are. */
  motion(): ReadonlyMap<string, { x: number; y: number }>;
  /**
   * Say you have the editor open on something, or null when you are done with it.
   *
   * Presence rather than broadcast, and that is the whole point: a lock that lives
   * in presence lifts itself the moment the person closes the tab or loses the
   * connection. One held in a broadcast or a row would have to be timed out, and
   * would be wrong for as long as the timeout lasted.
   */
  editing(id: string | null): void;
  /** Who is editing what, by entity id. */
  editors(): ReadonlyMap<string, Peer>;
  /** What everyone else should call you, and in what colour. */
  identify(name: string, color: string): void;
  dispose(): void;
}

/** 20Hz, which is what §4 asks for and more than a cursor needs. */
const CURSOR_MS = 50;

/** A pointer that has not moved in this long is treated as gone. */
const STALE_MS = 8000;

/** A thing that has not moved in this long has been let go, or its holder has. */
const MOTION_STALE_MS = 700;

/** How long to wait before saying the same thing again, after a send that failed. */
const SAY_RETRY_MS = 400;

/** And how long before trying a channel that closed, doubling up to the ceiling. */
const REOPEN_MS = 1000;
const REOPEN_MAX_MS = 30_000;

export interface PresenceOptions {
  boardId: string;
  userId: string;
}

export function boardPresence({
  boardId,
  userId,
}: PresenceOptions): BoardPresence {
  const listeners = new Set<() => void>();
  const others = new Map<string, Peer>();
  const names = new Map<
    string,
    { name: string; color: string; editing: string | null }
  >();
  const lastSeen = new Map<string, number>();
  /** Things other people are holding right now, by entity id. */
  const held = new Map<string, { x: number; y: number; at: number }>();
  let motionSnapshot: ReadonlyMap<string, { x: number; y: number }> = new Map();

  let mine: { name: string; color: string; editing: string | null } = {
    name: "someone",
    color: "#4b5563",
    editing: null,
  };
  let snapshot: Peer[] = [];
  let editorsSnapshot: ReadonlyMap<string, Peer> = new Map();
  let channel: RealtimeChannel | null = null;
  let disposed = false;
  let pending: { x: number; y: number } | null = null;
  let pendingMoves = new Map<string, { x: number; y: number }>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let reopenTimer: ReturnType<typeof setTimeout> | null = null;
  let said: string | null = null;
  let tries = 0;
  let reopens = 0;

  /**
   * What this client says about itself, and saying it again if it did not land.
   *
   * A `track` that times out or is refused is at best a lock nobody but you can
   * see, and at worst one that silently stops moving your cursor: the state is
   * sent whole every time, so saying it again is always safe and always correct.
   */
  const say = (): void => {
    const live = channel;
    if (disposed || !live) return;
    const payload = speaking();
    const signature = JSON.stringify(payload);
    if (signature === said) return;
    void live.track(payload).then(
      (result) => {
        if (disposed) return;
        if (result === "ok") {
          said = signature;
          tries = 0;
          return;
        }
        retrySay();
      },
      () => {
        if (!disposed) retrySay();
      },
    );
  };

  const retrySay = (): void => {
    if (disposed || retryTimer !== null || tries >= 3) return;
    tries += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      say();
    }, SAY_RETRY_MS * tries);
  };

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  /** Everything this client is telling the others about itself. */
  const speaking = (): Record<string, unknown> => ({
    userId,
    name: mine.name,
    color: mine.color,
    editing: mine.editing,
  });

  /**
   * The two views are rebuilt separately, and that is the point: a cursor arrives
   * twenty times a second and rebuilding the motion map alongside it would give
   * every subscriber — including the one drawing things being moved — a new
   * reference and a re-render for no reason at all. Rebuilt wholesale, because the
   * array identity is what `useSyncExternalStore` compares.
   */
  const refreshPeers = (): void => {
    const next: Peer[] = [];
    const byEntity = new Map<string, Peer>();
    for (const [id, identity] of names) {
      if (id === userId) continue;
      const peer: Peer = {
        userId: id,
        name: identity.name,
        color: identity.color,
        at: others.get(id)?.at ?? null,
        editing: identity.editing,
      };
      next.push(peer);
      if (peer.editing !== null) byEntity.set(peer.editing, peer);
    }
    next.sort((a, b) => a.userId.localeCompare(b.userId));
    snapshot = next;
    editorsSnapshot = byEntity;
    notify();
  };

  const refreshMotion = (): void => {
    const motion = new Map<string, { x: number; y: number }>();
    for (const [id, at] of held) motion.set(id, { x: at.x, y: at.y });
    motionSnapshot = motion;
    notify();
  };

  const sweep = setInterval(() => {
    if (disposed) return;
    const now = Date.now();
    let dropped = false;
    for (const [id, at] of lastSeen) {
      if (now - at > STALE_MS) {
        others.delete(id);
        lastSeen.delete(id);
        dropped = true;
      }
    }
    let unstuck = false;
    for (const [id, at] of held) {
      if (now - at.at > MOTION_STALE_MS) {
        held.delete(id);
        unstuck = true;
      }
    }
    if (dropped) refreshPeers();
    if (unstuck) refreshMotion();
  }, STALE_MS / 2);

  const flush = (): void => {
    timer = null;
    if (disposed || !pending || !channel) return;
    if (pending) {
      const at = pending;
      pending = null;
      void channel.send({
        type: "broadcast",
        event: "cursor",
        payload: { userId, x: at.x, y: at.y },
      });
    }

    if (pendingMoves.size > 0) {
      const moves = pendingMoves;
      pendingMoves = new Map();
      for (const [id, at] of moves) {
        void channel.send({
          type: "broadcast",
          event: "motion",
          payload: { userId, id, x: at.x, y: at.y },
        });
      }
    }
  };

  const open = (): void => {
    if (disposed || channel) return;

    let made: RealtimeChannel;
    try {
      made = getSupabase().channel(`board:${boardId}:public`, {
        config: { private: true },
      });
    } catch (error) {
      // No project, no presence. The board is still perfectly usable alone.
      console.warn("board: could not open a presence channel", error);
      return;
    }
    channel = made;

    made
      .on("presence", { event: "sync" }, () => {
        const state = channel?.presenceState() ?? {};
        names.clear();
        for (const [key, entries] of Object.entries(state)) {
          const first = (entries as Array<Record<string, unknown>>)[0];
          if (!first) continue;
          // Keyed by the announced user, not by the presence ref the channel
          // assigns: cursors arrive keyed by user, and the two have to agree.
          const id = typeof first.userId === "string" ? first.userId : key;
          names.set(id, {
            name: typeof first.name === "string" ? first.name : "someone",
            color: typeof first.color === "string" ? first.color : "#4b5563",
            editing: typeof first.editing === "string" ? first.editing : null,
          });
        }
        refreshPeers();
      })
      .on("broadcast", { event: "motion" }, ({ payload }) => {
        const body = payload as {
          userId?: string;
          id?: string;
          x?: number;
          y?: number;
        };
        if (!body?.id || body.userId === userId) return;
        if (typeof body.x !== "number" || typeof body.y !== "number") return;
        held.set(body.id, { x: body.x, y: body.y, at: Date.now() });
        refreshMotion();
      })
      .on("broadcast", { event: "cursor" }, ({ payload }) => {
        const body = payload as { userId?: string; x?: number; y?: number };
        if (!body?.userId || body.userId === userId) return;
        if (typeof body.x !== "number" || typeof body.y !== "number") return;
        others.set(body.userId, {
          userId: body.userId,
          name: names.get(body.userId)?.name ?? "someone",
          color: names.get(body.userId)?.color ?? "#4b5563",
          at: { x: body.x, y: body.y },
          editing: names.get(body.userId)?.editing ?? null,
        });
        lastSeen.set(body.userId, Date.now());
        refreshPeers();
      })
      .subscribe((status) => {
        if (disposed || channel !== made) return;
        if (status === "SUBSCRIBED") {
          reopens = 0;
          // A channel that has just joined has heard nothing from us.
          said = null;
          say();
          return;
        }
        // Supabase closes a channel and never opens it again, and a closed channel
        // takes every message silently: from here on nobody sees your cursor, or
        // the thing you are holding, and nothing says so. So it is opened again.
        void made.unsubscribe();
        channel = null;
        if (reopenTimer !== null) return;
        const wait = Math.min(REOPEN_MAX_MS, REOPEN_MS * 2 ** reopens);
        reopens += 1;
        reopenTimer = setTimeout(() => {
          reopenTimer = null;
          open();
        }, wait);
      });
  };

  open();

  return {
    peers: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    move(x, y) {
      if (disposed) return;
      pending = { x, y };
      if (timer === null) timer = setTimeout(flush, CURSOR_MS);
    },
    moveThing(id, x, y) {
      if (disposed) return;
      pendingMoves.set(id, { x, y });
      if (timer === null) timer = setTimeout(flush, CURSOR_MS);
    },
    motion: () => motionSnapshot,
    editors: () => editorsSnapshot,
    editing(id) {
      if (disposed || mine.editing === id) return;
      mine = { ...mine, editing: id };
      say();
    },
    identify(name, color) {
      if (disposed || (mine.name === name && mine.color === color)) return;
      mine = { ...mine, name, color };
      say();
    },
    dispose() {
      disposed = true;
      clearInterval(sweep);
      held.clear();
      pendingMoves.clear();
      if (timer !== null) clearTimeout(timer);
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (reopenTimer !== null) clearTimeout(reopenTimer);
      void channel?.unsubscribe();
      channel = null;
      listeners.clear();
    },
  };
}
