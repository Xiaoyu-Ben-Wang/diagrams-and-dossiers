import { useSyncExternalStore } from "react";

import { can, type Action, type Viewer } from "../access/permissions";
import { changedKeys, sameValue, withFields } from "../model/merge";
import type { BoardEntity, StringLink } from "../model/types";
import {
  localSync,
  type BoardChange,
  type BoardSync,
  type SyncStatus,
} from "../realtime/transport";

export interface BoardState {
  entities: BoardEntity[];
  strings: StringLink[];
}

export interface BoardStore {
  get(): BoardState;
  subscribe(listener: () => void): () => void;
  status(): SyncStatus;
  /** True while the board has been asked for again after a refused write. */
  resyncing(): boolean;

  /** The function form reads current state, so two additions in one tick see each other. */
  addEntities(
    build: BoardEntity[] | ((state: BoardState) => BoardEntity[]),
  ): void;
  removeEntities(ids: readonly string[]): void;
  /** A change that returns the same entity is not one. */
  updateEntities(
    ids: readonly string[],
    change: (entity: BoardEntity) => BoardEntity,
  ): void;

  /**
   * A change still in flight: applied here, and *not* written down. A drag calls
   * this on every frame, tells the others over the ephemeral channel, and the
   * single write happens once the gesture has been still for a moment. §4 makes
   * this the point of the split — twenty writes a second per dragged thing is
   * what the database was never meant to absorb.
   */
  previewEntities(
    ids: readonly string[],
    change: (entity: BoardEntity) => BoardEntity,
    /** How long it has to be still. Typing breathes more slowly than a drag. */
    quietMs?: number,
  ): void;

  addString(link: StringLink): void;
  removeStrings(ids: readonly string[]): void;
  updateStrings(
    ids: readonly string[],
    change: (link: StringLink) => StringLink,
  ): void;

  replaceAll(board: BoardState): void;

  applyRemote(change: BoardChange): void;

  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
}

/** How many steps are kept. Steps hold the entities they touched, not the whole board. */
const HISTORY_LIMIT = 60;

/** A run of changes to the same targets inside this window is one undo step. */
const COALESCE_MS = 600;

/** A refused write settles back to whatever the transport says after this long. */
const RESYNC_SETTLE_MS = 5000;

/**
 * How long a gesture has to be still before what it did is written. Long enough
 * that a continuous drag never writes, short enough that letting go commits
 * before anyone could notice.
 */
export const GESTURE_QUIET_MS = 250;

/**
 * Writing is a pause, not a keystroke. §4 asks for a debounced body save, and the
 * reason is not only politeness to the database: every write bumps the row's
 * version, and every bump is a chance for someone else's edit to be refused. A
 * body that writes twenty times a sentence turns every shared paragraph into a
 * race. Longer than a gap between keys, short enough not to hold text hostage.
 */
export const TYPING_QUIET_MS = 600;

export interface BoardStoreOptions {
  sync?: BoardSync;
  viewer: Viewer;
  initial?: BoardState;
}

/** What a step did to one thing: `null` on either side means it did not exist. */
interface Op<T> {
  before: T | null;
  after: T | null;
}

interface StepOps {
  entities: Map<string, Op<BoardEntity>>;
  strings: Map<string, Op<StringLink>>;
}

interface Step extends StepOps {
  key: string | null;
  at: number;
}

export function createBoardStore({
  sync = localSync(),
  viewer,
  initial,
}: BoardStoreOptions): BoardStore {
  let state: BoardState = initial ?? { entities: [], strings: [] };
  const listeners = new Set<() => void>();

  const emit = (next: BoardState): void => {
    state = next;
    for (const listener of listeners) listener();
  };

  const allowed = (action: Action, entity?: BoardEntity): boolean =>
    can(viewer, action, entity);

  const publish = (change: BoardChange): void => {
    sync.publish(change);
  };

  let past: Step[] = [];
  let future: Step[] = [];
  let last: { key: string; at: number } | null = null;

  /** A run that ended where it started is not a step anyone should have to undo. */
  const dropNetZero = (step: Step): void => {
    for (const [id, op] of step.entities) {
      if (op.before !== null && op.after !== null && sameValue(op.before, op.after)) {
        step.entities.delete(id);
      }
    }
    for (const [id, op] of step.strings) {
      if (op.before !== null && op.after !== null && sameValue(op.before, op.after)) {
        step.strings.delete(id);
      }
    }
  };

  /**
   * `emit`, with what the change did pushed onto the undo stack. `key` names a run
   * that is one step — a drag, a burst of typing; null is a step on its own.
   *
   * The run keeps the `before` it started with as it merges, so undo puts back
   * where the drag began rather than where the previous frame left it.
   */
  const commit = (
    ops: StepOps,
    next: BoardState,
    key: string | null = null,
  ): void => {
    const now = Date.now();
    const top = past[past.length - 1];
    const merged =
      key !== null && last?.key === key && now - last.at < COALESCE_MS && top !== undefined;
    let openForMerge = key !== null;

    if (merged) {
      for (const [id, op] of ops.entities) {
        const seen = top.entities.get(id);
        top.entities.set(
          id,
          seen ? { before: seen.before, after: op.after } : { ...op },
        );
      }
      for (const [id, op] of ops.strings) {
        const seen = top.strings.get(id);
        top.strings.set(
          id,
          seen ? { before: seen.before, after: op.after } : { ...op },
        );
      }
      top.at = now;
      dropNetZero(top);
      if (top.entities.size === 0 && top.strings.size === 0) {
        past.pop();
        // The step went; the one below it is older than this run, so nothing merges.
        openForMerge = false;
      }
    } else {
      past.push({
        key,
        at: now,
        entities: new Map(ops.entities),
        strings: new Map(ops.strings),
      });
      if (past.length > HISTORY_LIMIT) past.shift();
    }

    future = [];
    last = openForMerge ? { key: key as string, at: now } : null;
    emit(next);
  };

  /** Gestures whose write is still owed, by the id being moved. */
  const gestures = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * What each open gesture has changed so far. Kept so a change arriving from
   * elsewhere can be merged *under* work that has not been written yet, instead of
   * landing on top of it and taking the words away.
   */
  const pending = new Map<string, Op<BoardEntity>>();

  const targets = (kind: string, ids: readonly string[]): string =>
    `${kind}:${[...ids].sort().join(",")}`;

  const orphaned = (
    ids: ReadonlySet<string>,
    strings: StringLink[],
  ): StringLink[] =>
    strings.filter((link) => ids.has(link.from) || ids.has(link.to));

  // -------------------------------------------------------------------------
  // Undo
  // -------------------------------------------------------------------------

  interface Applied<T> {
    next: T[];
    upserts: T[];
    deletes: string[];
  }

  /**
   * Puts the step back (or forward again). An edit restores only the fields the
   * step touched, so a peer's change to some other field survives it — which is
   * the whole reason a step holds ops rather than a copy of the board.
   */
  const applyOps = <T extends { id: string }>(
    items: readonly T[],
    ops: ReadonlyMap<string, Op<T>>,
    direction: "undo" | "redo",
  ): Applied<T> => {
    const next = [...items];
    const upserts: T[] = [];
    const deletes: string[] = [];

    for (const [id, op] of ops) {
      const target = direction === "undo" ? op.before : op.after;
      const at = next.findIndex((item) => item.id === id);

      if (target === null) {
        if (at === -1) continue;
        next.splice(at, 1);
        deletes.push(id);
        continue;
      }

      if (at === -1) {
        // Only a deletion being undone brings a thing back. Undoing an edit whose
        // entity a peer has since removed is not a reason to resurrect it.
        const restoring =
          direction === "undo" ? op.after === null : op.before === null;
        if (!restoring) continue;
        next.push(target);
        upserts.push(target);
        continue;
      }

      const merged =
        op.before !== null && op.after !== null
          ? withFields(next[at], target, changedKeys(op.before, op.after))
          : target;
      next[at] = merged;
      upserts.push(merged);
    }

    return { next, upserts, deletes };
  };

  const applyStep = (step: Step, direction: "undo" | "redo"): void => {
    const entities = applyOps(state.entities, step.entities, direction);
    const strings = applyOps(state.strings, step.strings, direction);

    emit({ entities: entities.next, strings: strings.next });

    // Entities first: a peer holding a string whose endpoint it has not seen
    // yet can only resolve it once the entity has arrived.
    for (const entity of entities.upserts) publish({ kind: "entity/upsert", entity });
    for (const id of entities.deletes) publish({ kind: "entity/delete", id });
    for (const string of strings.upserts) publish({ kind: "string/upsert", string });
    for (const id of strings.deletes) publish({ kind: "string/delete", id });
  };

  // -------------------------------------------------------------------------
  // Refusals
  // -------------------------------------------------------------------------

  let resyncing = false;
  let settle: ReturnType<typeof setTimeout> | null = null;

  const settleResync = (): void => {
    if (settle !== null) clearTimeout(settle);
    settle = null;
    resyncing = false;
  };

  // A status change is not a board change, but everything watching the store has to
  // be told, or a pill showing the connection would sit on a stale answer.
  sync.onStatus(() => {
    for (const listener of listeners) listener();
  });

  sync.onOutcome((outcome) => {
    if (outcome.kind !== "rejected") return;
    // Blunt on purpose: reading the board again is one query and is always right,
    // where a shadow copy of "what the server last said" is a second source of
    // truth that is still wrong when the refusal came from a write we have not
    // seen. Refusals are rare, so the query is affordable.
    resyncing = true;
    if (settle !== null) clearTimeout(settle);
    // A denied write changes nothing, so no catch-up may ever arrive to clear it.
    settle = setTimeout(settleResync, RESYNC_SETTLE_MS);
    sync.resync();
  });

  // -------------------------------------------------------------------------
  // Remote
  // -------------------------------------------------------------------------

  const endpointsPresent = (
    link: StringLink,
    entities: readonly BoardEntity[],
  ): boolean =>
    entities.some((entity) => entity.id === link.from) &&
    entities.some((entity) => entity.id === link.to);

  // Catch-up is not topological, so a string can arrive before the thing it ties.
  const pendingStrings: StringLink[] = [];

  const flushPendingStrings = (): void => {
    if (pendingStrings.length === 0) return;
    const ready = pendingStrings.filter((link) =>
      endpointsPresent(link, state.entities),
    );
    if (ready.length === 0) return;

    for (const link of ready) pendingStrings.splice(pendingStrings.indexOf(link), 1);
    const strings = [...state.strings];
    for (const link of ready) {
      const at = strings.findIndex((other) => other.id === link.id);
      const seen = at === -1 ? null : strings[at];
      if (seen && seen.version >= link.version) continue;
      if (at === -1) strings.push(link);
      else strings[at] = link;
    }
    emit({ ...state, strings });
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status: () => sync.status(),
    resyncing: () => resyncing,

    addEntities(build) {
      const incoming = typeof build === "function" ? build(state) : build;
      if (incoming.length === 0) return;

      const permitted = incoming.filter((entity) => allowed("create", entity));
      if (permitted.length !== incoming.length) {
        // Logged, not thrown: this is a UI bug to find, and before the return so all-refused isn't silent.
        console.warn(
          "board: refused to create",
          incoming.length - permitted.length,
          "entities",
        );
      }
      if (permitted.length === 0) return;

      const entities = new Map<string, Op<BoardEntity>>();
      for (const entity of permitted) {
        entities.set(entity.id, { before: null, after: entity });
      }

      commit({ entities, strings: new Map() }, {
        ...state,
        entities: [...state.entities, ...permitted],
      });
      for (const entity of permitted)
        publish({ kind: "entity/upsert", entity });
    },

    removeEntities(ids) {
      if (!allowed("delete")) return;
      const doomed = new Set(ids);
      if (doomed.size === 0) return;

      // Captured before emit — `state` is reassigned, so reading it afterwards picks up the new list.
      const going = state.entities.filter((entity) => doomed.has(entity.id));
      const cut = orphaned(doomed, state.strings);
      if (going.length === 0 && cut.length === 0) return;

      const entities = new Map<string, Op<BoardEntity>>();
      for (const entity of going) {
        entities.set(entity.id, { before: entity, after: null });
      }
      const strings = new Map<string, Op<StringLink>>();
      for (const link of cut) strings.set(link.id, { before: link, after: null });

      const gone = new Set(going.map((entity) => entity.id));
      const severed = new Set(cut.map((link) => link.id));
      commit({ entities, strings }, {
        entities: state.entities.filter((entity) => !gone.has(entity.id)),
        strings: state.strings.filter((link) => !severed.has(link.id)),
      });

      for (const entity of going)
        publish({ kind: "entity/delete", id: entity.id });
      // Strings to removed entities are published as deletions; a peer left drawing one draws to the origin.
      for (const link of cut) publish({ kind: "string/delete", id: link.id });
    },

    updateEntities(ids, change) {
      const wanted = new Set(ids);
      const ops = new Map<string, Op<BoardEntity>>();

      const entities = state.entities.map((entity) => {
        if (!wanted.has(entity.id)) return entity;
        if (!allowed("edit", entity)) return entity;
        const updated = change(entity);
        if (updated === entity) return entity;
        ops.set(entity.id, { before: entity, after: updated });
        return updated;
      });

      if (ops.size === 0) return;
      commit({ entities: ops, strings: new Map() }, { ...state, entities }, targets("entity", ids));
      for (const op of ops.values()) {
        publish({ kind: "entity/upsert", entity: op.after as BoardEntity });
      }
    },

    previewEntities(ids, change, quietMs = GESTURE_QUIET_MS) {
      const wanted = new Set(ids);
      const ops = new Map<string, Op<BoardEntity>>();

      const entities = state.entities.map((entity) => {
        if (!wanted.has(entity.id)) return entity;
        if (!allowed("edit", entity)) return entity;
        const updated = change(entity);
        if (updated === entity) return entity;
        ops.set(entity.id, { before: entity, after: updated });
        return updated;
      });

      if (ops.size === 0) return;
      // Through `commit`, so the whole drag is still one undo step.
      commit({ entities: ops, strings: new Map() }, { ...state, entities }, targets("entity", ids));

      for (const [id, op] of ops) {
        const seen = pending.get(id);
        pending.set(
          id,
          seen ? { before: seen.before, after: op.after } : { ...op },
        );

        const owed = gestures.get(id);
        if (owed !== undefined) clearTimeout(owed);
        gestures.set(
          id,
          setTimeout(() => {
            gestures.delete(id);
            pending.delete(id);
            // Read at fire time: a drag that has since gone further sends the end.
            const entity = state.entities.find((each) => each.id === id);
            if (entity) publish({ kind: "entity/upsert", entity });
          }, quietMs),
        );
      }
    },

    addString(link) {
      if (!allowed("create")) return;
      const exists = state.strings.some(
        (other) =>
          (other.from === link.from && other.to === link.to) ||
          (other.from === link.to && other.to === link.from),
      );
      if (exists) return;

      const strings = new Map<string, Op<StringLink>>();
      strings.set(link.id, { before: null, after: link });

      commit({ entities: new Map(), strings }, {
        ...state,
        strings: [...state.strings, link],
      });
      publish({ kind: "string/upsert", string: link });
    },

    removeStrings(ids) {
      if (!allowed("delete")) return;
      const doomed = new Set(ids);
      const going = state.strings.filter((link) => doomed.has(link.id));
      if (going.length === 0) return;

      const strings = new Map<string, Op<StringLink>>();
      for (const link of going) strings.set(link.id, { before: link, after: null });

      commit({ entities: new Map(), strings }, {
        ...state,
        strings: state.strings.filter((link) => !doomed.has(link.id)),
      });
      for (const link of going) publish({ kind: "string/delete", id: link.id });
    },

    updateStrings(ids, change) {
      if (!allowed("edit")) return;
      const wanted = new Set(ids);
      const ops = new Map<string, Op<StringLink>>();

      const strings = state.strings.map((link) => {
        if (!wanted.has(link.id)) return link;
        const updated = change(link);
        if (updated === link) return link;
        ops.set(link.id, { before: link, after: updated });
        return updated;
      });

      if (ops.size === 0) return;
      commit({ entities: new Map(), strings: ops }, { ...state, strings }, targets("string", ids));
      for (const op of ops.values()) {
        publish({ kind: "string/upsert", string: op.after as StringLink });
      }
    },

    replaceAll(board) {
      if (!allowed("create")) return;

      const entities = new Map<string, Op<BoardEntity>>();
      const strings = new Map<string, Op<StringLink>>();

      const had = new Map(state.entities.map((entity) => [entity.id, entity]));
      for (const entity of board.entities) {
        const before = had.get(entity.id) ?? null;
        had.delete(entity.id);
        if (before !== null && sameValue(before, entity)) continue;
        entities.set(entity.id, { before, after: entity });
      }
      for (const [id, before] of had) entities.set(id, { before, after: null });

      const hadStrings = new Map(state.strings.map((link) => [link.id, link]));
      for (const link of board.strings) {
        const before = hadStrings.get(link.id) ?? null;
        hadStrings.delete(link.id);
        if (before !== null && sameValue(before, link)) continue;
        strings.set(link.id, { before, after: link });
      }
      for (const [id, before] of hadStrings) strings.set(id, { before, after: null });

      if (entities.size === 0 && strings.size === 0) return;

      // Copied so a caller holding the parsed object cannot mutate the board through it.
      commit({ entities, strings }, {
        entities: [...board.entities],
        strings: [...board.strings],
      });

      for (const op of entities.values()) {
        if (op.after === null) publish({ kind: "entity/delete", id: op.before!.id });
        else publish({ kind: "entity/upsert", entity: op.after });
      }
      for (const op of strings.values()) {
        if (op.after === null) publish({ kind: "string/delete", id: op.before!.id });
        else publish({ kind: "string/upsert", string: op.after });
      }
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,

    undo() {
      const step = past.pop();
      if (!step) return;
      future.push(step);
      last = null;
      applyStep(step, "undo");
    },

    redo() {
      const step = future.pop();
      if (!step) return;
      past.push(step);
      last = null;
      applyStep(step, "redo");
    },

    applyRemote(change) {
      settleResync();

      switch (change.kind) {
        case "entity/upsert": {
          const { entity } = change;
          const seen = state.entities.find((other) => other.id === entity.id);
          // Already applied, or older than what is held: this is what makes a
          // replayed echo of your own write a no-op.
          if (seen && seen.version >= entity.version) return;

          // Someone else got there first while this was still being worked on.
          // Take their version, put the unfinished work back on top of it, and go
          // on from there — otherwise their edit silently deletes your sentence.
          let arriving = entity;
          const open = pending.get(entity.id);
          if (open !== null && open !== undefined && open.before !== null && open.after !== null) {
            arriving = withFields(
              entity,
              open.after,
              changedKeys(open.before, open.after),
            );
            pending.set(entity.id, { before: entity, after: arriving });
          }

          const entities = seen
            ? state.entities.map((other) =>
                other.id === entity.id ? arriving : other,
              )
            : [...state.entities, arriving];
          emit({ ...state, entities });
          flushPendingStrings();
          return;
        }
        case "entity/delete": {
          const entities = state.entities.filter(
            (other) => other.id !== change.id,
          );
          if (entities.length === state.entities.length) return;
          const doomed = new Set([change.id]);
          const strings = state.strings.filter(
            (link) => !doomed.has(link.from) && !doomed.has(link.to),
          );
          // A string held for an endpoint that is now gone will never resolve.
          for (let at = pendingStrings.length - 1; at >= 0; at -= 1) {
            const link = pendingStrings[at];
            if (doomed.has(link.from) || doomed.has(link.to)) {
              pendingStrings.splice(at, 1);
            }
          }
          emit({ entities, strings });
          return;
        }
        case "string/upsert": {
          const { string } = change;
          const seen = state.strings.find((other) => other.id === string.id);
          if (seen && seen.version >= string.version) return;
          if (!endpointsPresent(string, state.entities)) {
            pendingStrings.push(string);
            return;
          }
          const strings = seen
            ? state.strings.map((other) =>
                other.id === string.id ? string : other,
              )
            : [...state.strings, string];
          emit({ ...state, strings });
          return;
        }
        case "string/delete": {
          const strings = state.strings.filter(
            (other) => other.id !== change.id,
          );
          if (strings.length === state.strings.length) return;
          emit({ ...state, strings });
        }
      }
    },
  };
}

export function useBoard(store: BoardStore): BoardState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
