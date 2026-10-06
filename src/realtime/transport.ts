import type { BoardEntity, StringLink } from '../model/types'

/** `version` is the entity's own, so a client can drop a change it has already applied. */
export type BoardChange =
  | { kind: 'entity/upsert'; entity: BoardEntity }
  | { kind: 'entity/delete'; id: string }
  | { kind: 'string/upsert'; string: StringLink }
  | { kind: 'string/delete'; id: string }

export type SyncStatus = 'offline' | 'connecting' | 'live'

export type PublishResult = 'sent' | 'local' | 'stale' | 'denied'

export interface BoardSync {
  /** Never throws: a board you cannot edit because the network is down is worse. */
  publish(change: BoardChange): PublishResult
  subscribe(listener: (change: BoardChange) => void): () => void
  status(): SyncStatus
}

export function localSync(): BoardSync {
  return {
    publish: () => 'local',
    subscribe: () => () => {},
    status: () => 'offline',
  }
}

/** Test-only: records what was published without standing up a socket. */
export function recordingSync(): BoardSync & { published: BoardChange[] } {
  const published: BoardChange[] = []
  const listeners = new Set<(change: BoardChange) => void>()

  return {
    published,
    publish(change) {
      published.push(change)
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
