/**
 * Getting local changes to the server without making the pointer wait.
 *
 * The store applies a change and publishes it in the same tick, because a drag
 * that waited for a round trip would lag the cursor. Everything after that is
 * this file's problem: one write in flight per thing at a time, later changes to
 * the same thing collapsed into the one that is still coming, and a refusal
 * routed back so the board can be corrected.
 */
import type { BoardChange, SyncOutcome } from "./transport";

export type RowOutcome =
  /** `version` is what the server now holds, so the echo of this write is known. */
  | { kind: "ok"; version?: number }
  /** Someone else wrote first. Carries what the server holds now. */
  | { kind: "stale"; change: BoardChange }
  | { kind: "missing" }
  | { kind: "denied" }
  /** The network, not the database. Worth trying again. */
  | { kind: "offline" };

export interface BoardWriter {
  write(change: BoardChange): Promise<RowOutcome>;
}

export interface OutboxOptions {
  writer: BoardWriter;
  /** Server truth, when a write lost and the row has to be corrected locally. */
  apply: (change: BoardChange) => void;
  outcome: (outcome: SyncOutcome) => void;
}

/** A drag emits ~20 changes a second; this is how many of them become writes. */
export const COALESCE_MS = 150;

/** Backoff for a network that is down, rather than a database that said no. */
export const RETRY_MS = [500, 1500, 4000, 10000];

export function changeId(change: BoardChange): string {
  switch (change.kind) {
    case "entity/upsert":
      return change.entity.id;
    case "entity/delete":
      return change.id;
    case "string/upsert":
      return change.string.id;
    case "string/delete":
      return change.id;
  }
}

export interface Outbox {
  send(change: BoardChange): void;
  /**
   * True when a row coming back from the server is this client's own write.
   *
   * A drag writes, the server bumps the version, and the echo comes straight back.
   * Applying it would move the note to wherever the server last heard it — a round
   * trip behind the pointer — so the drag fights its own reflection and drifts.
   * Both halves matter: the id is ours while a change is queued or in flight, and
   * the version is ours once the write has been answered. A drag writes several
   * times, and their echoes do not arrive in order — so it is every version up to
   * the last one written, not only that one. The version predicate is what makes
   * that safe: a write lands on top of whatever was there, so everything at or
   * below the version we were answered with was ours, and anything above it is
   * someone who came after.
   */
  isOwn(id: string, version: number): boolean;
  /** Drops everything queued. The board is going away. */
  dispose(): void;
}

export function createOutbox({
  writer,
  apply,
  outcome,
}: OutboxOptions): Outbox {
  interface Queued {
    change: BoardChange;
    busy: boolean;
    attempt: number;
    timer: ReturnType<typeof setTimeout> | null;
  }

  const queue = new Map<string, Queued>();
  /** The version each write was answered with, so its echo can be recognised. */
  const written = new Map<string, number>();
  let disposed = false;

  const settle = (item: Queued, result: RowOutcome): void => {
    const { change } = item;

    switch (result.kind) {
      case "ok":
        item.attempt = 0;
        if (result.version !== undefined) {
          written.set(changeId(change), result.version);
        }
        outcome({ kind: "confirmed", change });
        return;
      case "stale":
        // The row is whatever the server says now. Handing it to the store is the
        // rollback: the local optimistic edit is replaced by the truth.
        apply(result.change);
        outcome({ kind: "rejected", change, reason: "stale" });
        return;
      case "missing":
        // Someone deleted it. Undoing that locally is not ours to do.
        apply(
          change.kind === "string/upsert"
            ? { kind: "string/delete", id: change.string.id }
            : { kind: "entity/delete", id: changeId(change) },
        );
        outcome({ kind: "rejected", change, reason: "missing" });
        return;
      case "denied":
        outcome({ kind: "rejected", change, reason: "denied" });
        return;
      case "offline": {
        const wait = RETRY_MS[Math.min(item.attempt, RETRY_MS.length - 1)];
        item.attempt += 1;
        if (item.timer !== null) clearTimeout(item.timer);
        item.timer = setTimeout(() => {
          item.timer = null;
          void drain(item);
        }, wait);
        return;
      }
    }
  };

  const drain = async (item: Queued | undefined): Promise<void> => {
    if (disposed || !item || item.busy) return;
    item.busy = true;

    const change = item.change;
    let result: RowOutcome;
    try {
      result = await writer.write(change);
    } catch {
      // A writer that threw is a writer that could not reach the server.
      result = { kind: "offline" };
    }

    if (disposed) return;
    item.busy = false;
    settle(item, result);

    // Something arrived while that was in flight; it is already the newest intent.
    if (item.timer === null && queue.get(changeId(change)) === item) {
      if (item.change !== change) void drain(item);
      else if (result.kind !== "offline") queue.delete(changeId(change));
    }
  };

  return {
    send(change) {
      if (disposed) return;
      const id = changeId(change);
      const already = queue.get(id);

      if (already) {
        // Latest intent wins; the write in flight will pick this up when it lands.
        already.change = change;
        return;
      }

      const item: Queued = { change, busy: false, attempt: 0, timer: null };
      queue.set(id, item);
      item.timer = setTimeout(() => {
        item.timer = null;
        void drain(item);
      }, COALESCE_MS);
    },

    isOwn(id, version) {
      if (queue.has(id)) return true;
      const mine = written.get(id);
      return mine !== undefined && version <= mine;
    },

    dispose() {
      disposed = true;
      written.clear();
      for (const item of queue.values()) {
        if (item.timer !== null) clearTimeout(item.timer);
      }
      queue.clear();
    },
  };
}
