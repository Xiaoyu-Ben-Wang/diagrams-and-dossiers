// The list of boards, over whichever storage is in hand.
//
// `get()` must return a stable reference for `useSyncExternalStore`, so the cache
// is only reassigned when something actually changed.

import { useSyncExternalStore } from 'react'

import type { BoardState } from '../board/store'
import { byUpdatedDesc, type BoardStorage } from './board-storage'
import { createBoardRecord, uniqueBoardName, type BoardRecord } from './board-record'
import { loadLastOpenId, saveLastOpenId } from './last-open'

export interface BoardLibrary {
  get(): BoardRecord[]
  ready(): boolean
  degraded(): boolean
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
  create(name: string, board?: BoardState): Promise<BoardRecord>
  rename(id: string, name: string): Promise<boolean>
  remove(id: string): Promise<void>
  /** What autosave writes. Discrete actions above write straight through. */
  saveDocument(id: string, board: BoardState): Promise<void>
}

export interface BoardLibraryOptions {
  now?: () => number
}

const EMPTY: BoardState = { entities: [], strings: [] }

export function createBoardLibrary(
  storage: BoardStorage,
  options: BoardLibraryOptions = {},
): BoardLibrary {
  const now = options.now ?? Date.now
  const listeners = new Set<() => void>()

  // A storage that can answer synchronously — the in-memory one — is answered
  // before any await, so its callers never see a loading frame.
  const immediate = storage.snapshot?.()
  let records: BoardRecord[] = immediate ? [...immediate].sort(byUpdatedDesc) : []
  let ready = immediate !== undefined

  const emit = (): void => {
    for (const listener of listeners) listener()
  }

  const commit = (next: BoardRecord[]): void => {
    records = [...next].sort(byUpdatedDesc)
    emit()
  }

  const replace = (record: BoardRecord): void => {
    commit([record, ...records.filter((existing) => existing.id !== record.id)])
  }

  const find = (id: string): BoardRecord | undefined =>
    records.find((record) => record.id === id)

  return {
    get: () => records,
    ready: () => ready,
    degraded: () => storage.degraded?.() === true,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async refresh() {
      const loaded = await storage.list()
      ready = true
      commit(loaded)
    },

    async create(name, board = EMPTY) {
      const record = createBoardRecord(
        uniqueBoardName(records.map((existing) => existing.name), name),
        board,
        now(),
      )
      await storage.put(record)
      replace(record)
      return record
    },

    async rename(id, name) {
      const trimmed = name.trim()
      if (trimmed === '') return false
      const existing = find(id)
      if (!existing) return false

      const renamed = { ...existing, name: trimmed, updatedAt: now() }
      await storage.put(renamed)
      replace(renamed)
      return true
    },

    async remove(id) {
      await storage.remove(id)
      commit(records.filter((record) => record.id !== id))
      // Otherwise `/` would try to open a board that is not there any more.
      if (loadLastOpenId() === id) saveLastOpenId(null)
    },

    async saveDocument(id, board) {
      const existing = find(id)
      // A board that is not in the library is one that was never saved: writing it
      // now would resurrect something the user deleted.
      if (!existing) return

      const saved = { ...existing, board, updatedAt: now() }
      await storage.put(saved)
      replace(saved)
    },
  }
}

export function useLibrary(library: BoardLibrary): BoardRecord[] {
  return useSyncExternalStore(library.subscribe, library.get, library.get)
}
