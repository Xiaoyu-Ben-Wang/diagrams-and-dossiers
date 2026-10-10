import type { BoardEntity, StringLink } from "../model/types";

/** `version` is the entity's own, so a client can drop a change it has already applied. */
export type BoardChange =
  | { kind: "entity/upsert"; entity: BoardEntity }
  | { kind: "entity/delete"; id: string }
  | { kind: "string/upsert"; string: StringLink }
  | { kind: "string/delete"; id: string };

export type SyncStatus = "offline" | "connecting" | "live";

/**
 * What `publish` can answer straight away. `sent` means the change is durably
 * queued on this machine — *not* that the server has it, which cannot be known
 * without a round trip and so is not part of a synchronous return. `local` means
 * there is no remote at all: the demo, a seed, a test.
 */
export type PublishResult = "sent" | "local";

/**
 * `stale` means someone else wrote the row first; `missing` means they deleted
 * it; `denied` means it was readable and unchanged and still refused, which after
 * a join usually means membership is gone. The last two are told apart by a
 * read-back, because PostgREST reports a stale write and an RLS refusal the same
 * way: an empty result and no error.
 */
export type RejectReason = "stale" | "denied" | "missing";

export type SyncOutcome =
  | { kind: "confirmed"; change: BoardChange }
  | { kind: "rejected"; change: BoardChange; reason: RejectReason };

export interface BoardSync {
  /** Never throws: a board you cannot edit because the network is down is worse. */
  publish(change: BoardChange): PublishResult;
  subscribe(listener: (change: BoardChange) => void): () => void;
  /** How a rejection gets back to the store, since `publish` cannot return one. */
  onOutcome(listener: (outcome: SyncOutcome) => void): () => void;
  /** Read the board again from the last point seen. Fire and forget. */
  resync(): void;
  status(): SyncStatus;
  /**
   * The connection changing is not a change to the board, so it needs saying
   * separately — otherwise anything showing the status only updates when somebody
   * happens to edit something.
   */
  onStatus(listener: (status: SyncStatus) => void): () => void;
  /** Lets go of the socket. A screen that closes without this leaves one behind. */
  dispose(): void;
}

export function localSync(): BoardSync {
  return {
    publish: () => "local",
    subscribe: () => () => {},
    onOutcome: () => () => {},
    resync: () => {},
    status: () => "offline",
    onStatus: () => () => {},
    dispose: () => {},
  };
}

/** Test-only: records what was published without standing up a socket. */
export function recordingSync(): BoardSync & {
  published: BoardChange[];
  /** Reject the last change, the way a real transport would asynchronously. */
  reject(change: BoardChange, reason: RejectReason): void;
  confirm(change: BoardChange): void;
  resyncs(): number;
} {
  const published: BoardChange[] = [];
  const listeners = new Set<(change: BoardChange) => void>();
  const outcomes = new Set<(outcome: SyncOutcome) => void>();
  let resynced = 0;

  const tell = (outcome: SyncOutcome): void => {
    for (const listener of outcomes) listener(outcome);
  };

  return {
    published,
    publish(change) {
      published.push(change);
      for (const listener of listeners) listener(change);
      return "sent";
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onOutcome(listener) {
      outcomes.add(listener);
      return () => outcomes.delete(listener);
    },
    resync() {
      resynced += 1;
    },
    resyncs: () => resynced,
    onStatus: () => () => {},
    dispose: () => {},
    reject: (change, reason) => tell({ kind: "rejected", change, reason }),
    confirm: (change) => tell({ kind: "confirmed", change }),
    status: () => "live",
  };
}
