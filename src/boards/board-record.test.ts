import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BOARD_NAME,
  createBoardRecord,
  newBoardId,
  parseBoardRecord,
  uniqueBoardName,
} from './board-record'

const emptyBoard = { entities: [], strings: [] }

describe('parseBoardRecord', () => {
  it('refuses anything that is not a record, whatever it is', () => {
    for (const value of [null, undefined, 42, 'a board', [], true]) {
      expect(parseBoardRecord(value), String(value)).toBeNull()
    }
  })

  it('needs an id and a name', () => {
    expect(parseBoardRecord({ name: 'Ledger' })).toBeNull()
    expect(parseBoardRecord({ id: 'abc' })).toBeNull()
    expect(parseBoardRecord({ id: '', name: 'Ledger' })).toBeNull()
    expect(parseBoardRecord({ id: 'abc', name: '   ' })).toBeNull()
  })

  it('keeps a record that has both, and trims the name', () => {
    const parsed = parseBoardRecord({
      id: 'abc',
      name: '  The Drowned Bell  ',
      createdAt: 10,
      updatedAt: 20,
      board: emptyBoard,
    })

    expect(parsed).toEqual({
      id: 'abc',
      name: 'The Drowned Bell',
      createdAt: 10,
      updatedAt: 20,
      board: emptyBoard,
    })
  })

  it('gives a record without timestamps a zero date rather than dropping it', () => {
    const parsed = parseBoardRecord({ id: 'abc', name: 'Ledger', board: emptyBoard })

    expect(parsed).toMatchObject({ createdAt: 0, updatedAt: 0 })
  })

  it('falls back to the created date when only that one survived', () => {
    const parsed = parseBoardRecord({ id: 'abc', name: 'Ledger', createdAt: 7 })

    expect(parsed).toMatchObject({ createdAt: 7, updatedAt: 7 })
  })

  it('takes a record whose document is missing rather than losing the whole board', () => {
    // The name and id are the user's; the document can be rebuilt, not the name.
    expect(parseBoardRecord({ id: 'abc', name: 'Ledger' })?.board).toEqual(emptyBoard)
    expect(parseBoardRecord({ id: 'abc', name: 'Ledger', board: 'nonsense' })?.board).toEqual(
      emptyBoard,
    )
  })

  it('drops fields it does not know', () => {
    const parsed = parseBoardRecord({
      id: 'abc',
      name: 'Ledger',
      board: emptyBoard,
      slug: 'ledger',
      viewToken: 'secret',
    })

    expect(parsed).not.toHaveProperty('slug')
    expect(parsed).not.toHaveProperty('viewToken')
  })
})

describe('createBoardRecord', () => {
  it('mints an id and dates the record', () => {
    const record = createBoardRecord('Ledger', emptyBoard, 99)

    expect(record.id).not.toBe('')
    expect(record).toMatchObject({ name: 'Ledger', createdAt: 99, updatedAt: 99 })
  })

  it('never makes a nameless board', () => {
    expect(createBoardRecord('   ', emptyBoard).name).toBe(DEFAULT_BOARD_NAME)
  })

  it('makes two boards two ids', () => {
    expect(createBoardRecord('a', emptyBoard).id).not.toBe(createBoardRecord('b', emptyBoard).id)
  })
})

describe('newBoardId', () => {
  it('is a uuid where the platform can make one', () => {
    expect(newBoardId()).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('uniqueBoardName', () => {
  it('leaves a name nobody has taken', () => {
    expect(uniqueBoardName(['Ledger'], 'Manifest')).toBe('Manifest')
  })

  it('numbers a name that is taken, and numbers the number', () => {
    expect(uniqueBoardName(['Ledger'], 'Ledger')).toBe('Ledger (2)')
    expect(uniqueBoardName(['Ledger', 'Ledger (2)'], 'Ledger')).toBe('Ledger (3)')
  })

  it('falls back to the default rather than naming a board nothing', () => {
    expect(uniqueBoardName([], '  ')).toBe(DEFAULT_BOARD_NAME)
  })
})
