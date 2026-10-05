/**
 * How a change gets to everyone else looking at this board.
 *
 * There is nothing on the other end yet. This exists anyway, and now rather
 * than later, because the shape of "what a change is" is the thing that decides
 * whether live editing is a small addition or a rewrite. Every mutation on the
 * board goes through here as a described change rather than as a new array of
 * entities, so when a socket appears it is a second implementation of one
 * interface and not a re-plumbing of the editor.
 *
 * The rules that shape it:
 *
 *  - **A change names one thing.** Not "here is the board", which is what a
 *    client that only ever mutates locally can get away with. Two people moving
 *    different pins at once must not each overwrite the other's board, and a
 *    whole-board message cannot express that.
 *
 *  - **Deletes are separate from writes.** A tombstone has to be
 *    distinguishable from silence: a client that never hears about a deletion
 *    keeps showing the thing, and re-sending the whole board to fix that is the
 *    same overwrite problem again.
 *
 *  - **Ids are minted on the client.** `docs/architecture.md` requires it, and
 *    it is what makes a change idempotent — applying the same upsert twice
 *    leaves the same board, so a retry after a dropped connection is safe.
 *
 *  - **`stale` is not a failure.** A change computed against a version that has
 *    since moved on should be rejected and re-derived, not applied. The
 *    transport reports that outcome rather than hiding it, because a client
 *    that cannot tell "rejected" from "applied" will drift silently.
 */

import type { BoardEntity, StringLink } from '../model/types'

/**
 * One thing that happened on the board.
 *
 * `version` is the entity's own, carried so a receiving client can tell a
 * change it has already applied from one it has not — the ids are stable and
 * the same change will arrive more than once across a reconnect.
 */
export type BoardChange =
  | { kind: 'entity/upsert'; entity: BoardEntity }
  | { kind: 'entity/delete'; id: string }
  | { kind: 'string/upsert'; string: StringLink }
  | { kind: 'string/delete'; id: string }

/** What the connection is doing, for a badge somewhere. */
export type SyncStatus = 'offline' | 'connecting' | 'live'

/** What became of a change that was published. */
export type PublishResult = 'sent' | 'local' | 'stale' | 'denied'

export interface BoardSync {
  /**
   * Send a change. Never throws: a board you cannot edit because the network is
   * down is a worse failure than a change that reaches the others late.
   */
  publish(change: BoardChange): PublishResult
  /**
   * Hear about changes made elsewhere. Returns the unsubscribe.
   *
   * The listener is handed changes and nothing else — it is not told who sent
   * them or how, because a board does not render differently for a change made
   * by one person rather than another.
   */
  subscribe(listener: (change: BoardChange) => void): () => void
  /** The connection's state, read rather than subscribed to. */
  status(): SyncStatus
}

/**
 * The transport for a board with one person on it.
 *
 * Publishing does nothing and no change ever arrives, which is exactly right
 * for a board that is only in this browser. It is not a placeholder that throws
 * — it is the honest implementation of "there is nobody else here", and it
 * means the calls that will one day cross a network are already written, in the
 * places they will need to be.
 */
export function localSync(): BoardSync {
  return {
    publish: () => 'local',
    subscribe: () => () => {},
    status: () => 'offline',
  }
}

/**
 * A transport that keeps what it was told, for tests.
 *
 * Not shipped — it exists so that a test can assert a change was published
 * without standing up a socket, which is the only way the seam stays honest
 * rather than aspirational.
 */
export function recordingSync(): BoardSync & { published: BoardChange[] } {
  const published: BoardChange[] = []
  const listeners = new Set<(change: BoardChange) => void>()

  return {
    published,
    publish(change) {
      published.push(change)
      // Fanned out to local subscribers too, so a board with two views of the
      // same store behaves the way it will when the second view is a person.
      for (const listener of listeners) listener(change)
      return 'sent'
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    status: () => 'live',
  }
}
