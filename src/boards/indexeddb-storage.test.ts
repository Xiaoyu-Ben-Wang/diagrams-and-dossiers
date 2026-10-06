// jsdom implements no IndexedDB, so the durable path cannot be exercised here —
// that is what the browser pass is for. What this does cover is the path that
// matters most when it goes wrong: the adapter has to keep working, and it has to
// say that it is not saving.

import { afterEach, describe, expect, it } from 'vitest'

import { indexedDbBoardStorage } from './indexeddb-storage'
import { createBoardRecord } from './board-record'

const board = { entities: [], strings: [] }

function setIndexedDb(value: unknown): void {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'indexedDB')
})

describe('the board store without IndexedDB', () => {
  it('admits it is degraded rather than pretending', () => {
    setIndexedDb(undefined)

    expect(indexedDbBoardStorage().degraded?.()).toBe(true)
  })

  it('still keeps boards, for as long as the tab is open', async () => {
    setIndexedDb(undefined)
    const storage = indexedDbBoardStorage()
    const ledger = createBoardRecord('Ledger', board, 1)

    await storage.put(ledger)

    expect(await storage.get(ledger.id)).toEqual(ledger)
    expect(await storage.list()).toEqual([ledger])

    await storage.remove(ledger.id)

    expect(await storage.list()).toEqual([])
  })

  it('starts a caller on the first render, since it has nothing to wait for', () => {
    setIndexedDb(undefined)

    expect(indexedDbBoardStorage().snapshot?.()).toEqual([])
  })

  it('degrades when the open throws, rather than throwing at its caller', async () => {
    setIndexedDb({
      open: () => {
        throw new Error('blocked by policy')
      },
    })
    const storage = indexedDbBoardStorage()

    // Lazy: the board still opens, and the failure is reported when a read
    // actually needs the database.
    expect(storage.degraded?.()).toBe(false)
    expect(await storage.list()).toEqual([])
    expect(storage.degraded?.()).toBe(true)
  })
})
