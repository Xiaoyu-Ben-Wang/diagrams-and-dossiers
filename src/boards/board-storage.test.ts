import { describe, expect, it } from 'vitest'

import { memoryBoardStorage } from './board-storage'
import { createBoardRecord } from './board-record'

const board = { entities: [], strings: [] }
const record = (name: string, updatedAt: number) => ({
  ...createBoardRecord(name, board, updatedAt),
  updatedAt,
})

describe('the in-memory board store', () => {
  it('gives back what was put in', async () => {
    const storage = memoryBoardStorage()
    const ledger = record('Ledger', 1)

    await storage.put(ledger)

    expect(await storage.get(ledger.id)).toEqual(ledger)
  })

  it('is null for a board it has never seen', async () => {
    expect(await memoryBoardStorage().get('nobody')).toBeNull()
  })

  it('lists the most recently changed board first', async () => {
    const storage = memoryBoardStorage()
    await storage.put(record('old', 1))
    await storage.put(record('new', 9))
    await storage.put(record('middle', 5))

    expect((await storage.list()).map((each) => each.name)).toEqual(['new', 'middle', 'old'])
  })

  it('replaces a board rather than duplicating it', async () => {
    const storage = memoryBoardStorage()
    const ledger = record('Ledger', 1)
    await storage.put(ledger)

    await storage.put({ ...ledger, name: 'Renamed', updatedAt: 2 })

    expect(await storage.list()).toHaveLength(1)
    expect((await storage.get(ledger.id))?.name).toBe('Renamed')
  })

  it('forgets a board that was removed', async () => {
    const storage = memoryBoardStorage()
    const ledger = record('Ledger', 1)
    await storage.put(ledger)

    await storage.remove(ledger.id)

    expect(await storage.get(ledger.id)).toBeNull()
    expect(await storage.list()).toEqual([])
  })

  it('hands its records over synchronously, which is how a caller is ready on the first render', () => {
    const ledger = record('Ledger', 1)

    expect(memoryBoardStorage([ledger]).snapshot?.()).toEqual([ledger])
  })

  it('is not degraded unless it is told it is standing in for something', () => {
    expect(memoryBoardStorage().degraded?.()).toBe(false)
    expect(memoryBoardStorage([], { degraded: true }).degraded?.()).toBe(true)
  })
})
