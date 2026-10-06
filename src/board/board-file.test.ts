import { describe, expect, it } from 'vitest'

import { demoBoard } from '../app/demo'
import type { BoardState } from './store'
import {
  BOARD_FILE_FORMAT,
  BOARD_FILE_VERSION,
  DEFAULT_BOARD_FILE_NAME,
  boardFileName,
  parseBoardFile,
  serializeBoard,
} from './board-file'

function tinyBoard(): BoardState {
  return {
    entities: [
      {
        id: 'a-page',
        kind: 'article',
        title: 'A Page',
        bodyMd: '# A Page\n\nWords.',
        visibility: 'shared',
        status: 'theory',
        dateInherit: true,
        nudge: { x: 0, y: 0 },
        zIndex: 0,
        version: 1,
        createdAt: 1,
        updatedAt: 2,
        board: { x: 10, y: 20 },
        rotation: 0,
        options: {
          width: 720,
          typeScale: 'normal',
          paper: 'parchment',
          titleBar: true,
          editable: true,
          acceptsPins: true,
          collapsible: false,
          collapsed: false,
        },
      },
      {
        id: 'a-note',
        kind: 'note',
        bodyMd: 'What we know.',
        visibility: 'shared',
        status: 'theory',
        dateInherit: true,
        nudge: { x: 0, y: 0 },
        zIndex: 0,
        version: 1,
        createdAt: 1,
        updatedAt: 2,
        board: { x: -200, y: 40 },
        width: 168,
        height: 128,
        fontScale: 1,
      },
    ],
    strings: [
      {
        id: 'yarn',
        from: 'a-note',
        to: 'a-page',
        slack: 0.18,
        color: '#a3302b',
        style: 'solid',
        label: 'the claim',
        labelAt: 0.5,
        visibility: 'shared',
      },
    ],
  }
}

function fileWith(board: unknown, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: BOARD_FILE_FORMAT,
    version: BOARD_FILE_VERSION,
    exportedAt: '2026-01-01T00:00:00.000Z',
    board,
    ...overrides,
  })
}

function refusal(text: string): string {
  const result = parseBoardFile(text)
  if (result.ok) throw new Error('expected the file to be refused, and it was read')
  return result.reason
}

describe('a board file', () => {
  it('round-trips the demo board unchanged', () => {
    const original = demoBoard()
    const result = parseBoardFile(serializeBoard(original))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.board.entities).toEqual(original.entities)
    expect(result.board.strings).toEqual(original.strings)
  })

  it('round-trips a board with no pages on it', () => {
    const empty: BoardState = { entities: [], strings: [] }
    const result = parseBoardFile(serializeBoard(empty))

    expect(result).toEqual({ ok: true, board: { entities: [], strings: [] } })
  })

  it('says what it is, so a reader can tell one file from another', () => {
    const file = JSON.parse(serializeBoard(tinyBoard()))

    expect(file.format).toBe(BOARD_FILE_FORMAT)
    expect(file.version).toBe(BOARD_FILE_VERSION)
    expect(typeof file.exportedAt).toBe('string')
  })

  it('keeps fields it does not know about out of the board', () => {
    const board = tinyBoard()
    const withUnknown = {
      ...board,
      entities: board.entities.map((entity) => ({ ...entity, mood: 'wistful' })),
    }
    const result = parseBoardFile(fileWith(withUnknown))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.board.entities[0]).not.toHaveProperty('mood')
  })
})

describe('refusing a file', () => {
  it('refuses text that is not JSON', () => {
    expect(refusal('not json at all')).toContain('not JSON')
  })

  it('refuses JSON that is not a board', () => {
    expect(refusal('{"hello":"world"}')).toContain('not a case board')
  })

  it('refuses a version it does not know rather than guessing', () => {
    const reason = refusal(fileWith(tinyBoard(), { version: BOARD_FILE_VERSION + 1 }))
    expect(reason).toContain(`version ${BOARD_FILE_VERSION + 1}`)
  })

  it('refuses a thing of no known kind, and says which one', () => {
    const board = tinyBoard()
    const broken = { ...board, entities: [{ ...board.entities[0], kind: 'doodle' }] }

    expect(refusal(fileWith(broken))).toContain('entities[0].kind')
  })

  it('refuses a note with no place on the board', () => {
    const board = tinyBoard()
    const note: Record<string, unknown> = { ...board.entities[1] }
    delete note.board
    const broken = { ...board, entities: [board.entities[0], note] }

    expect(refusal(fileWith(broken))).toContain('entities[1].board')
  })

  it('refuses a point that is not two numbers', () => {
    const board = tinyBoard()
    const broken = {
      ...board,
      entities: [board.entities[0], { ...board.entities[1], board: { x: 'left', y: 0 } }],
    }

    expect(refusal(fileWith(broken))).toContain('entities[1].board.x')
  })

  it('refuses two things sharing an id', () => {
    const board = tinyBoard()
    const broken = { ...board, entities: [board.entities[0], { ...board.entities[1], id: 'a-page' }] }

    expect(refusal(fileWith(broken))).toContain('share an id')
  })

  it('refuses a string tied to something that is not in the file', () => {
    // A dangling end is drawn to the board's origin, so this is not cosmetic.
    const board = tinyBoard()
    const broken = { ...board, strings: [{ ...board.strings[0], to: 'nobody' }] }

    expect(refusal(fileWith(broken))).toContain('strings[0]')
  })

  it('refuses an image source that is not one', () => {
    const board = tinyBoard()
    const broken = {
      ...board,
      entities: [
        board.entities[0],
        {
          ...board.entities[1],
          kind: 'image',
          src: 'javascript:alert(1)',
          fit: 'cover',
          edge: 'clean',
          edgeSeed: 1,
        },
      ],
    }

    expect(refusal(fileWith(broken))).toContain('entities[1].src')
  })

  it('refuses an image source too large to be a picture', () => {
    const board = tinyBoard()
    const broken = {
      ...board,
      entities: [
        board.entities[0],
        {
          ...board.entities[1],
          kind: 'image',
          src: `data:image/png;base64,${'A'.repeat(9 * 1024 * 1024)}`,
          fit: 'cover',
          edge: 'clean',
          edgeSeed: 1,
        },
      ],
    }

    expect(refusal(fileWith(broken))).toContain('entities[1].src')
  })

  it('carries the size of a note’s writing', () => {
    const board = tinyBoard()
    const sized = { ...board.entities[1], fontScale: 1.75 }
    const result = parseBoardFile(fileWith({ ...board, entities: [board.entities[0], sized] }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.board.entities[1]).toMatchObject({ fontScale: 1.75 })
  })

  it('carries the colour of a note', () => {
    const board = tinyBoard()
    const painted = { ...board.entities[1], color: '#cfd6bd' }
    const result = parseBoardFile(fileWith({ ...board, entities: [board.entities[0], painted] }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.board.entities[1]).toMatchObject({ color: '#cfd6bd' })
  })

  it('gives a note its normal size when the file predates the setting', () => {
    const board = tinyBoard()
    const older: Record<string, unknown> = { ...board.entities[1] }
    delete older.fontScale
    const result = parseBoardFile(fileWith({ ...board, entities: [board.entities[0], older] }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.board.entities[1]).toMatchObject({ fontScale: 1 })
  })

  it('takes an http picture, which is how a dropped file arrives', () => {
    const board = tinyBoard()
    const withImage = {
      ...board,
      entities: [
        board.entities[0],
        {
          ...board.entities[1],
          kind: 'image',
          src: 'https://example.test/scan.png',
          fit: 'cover',
          edge: 'torn',
          edgeSeed: 7,
        },
      ],
    }

    expect(parseBoardFile(fileWith(withImage)).ok).toBe(true)
  })

  it('clamps slack rather than refusing a rope that sags oddly', () => {
    const board = tinyBoard()
    const broken = { ...board, strings: [{ ...board.strings[0], slack: 99, labelAt: -4 }] }
    const result = parseBoardFile(fileWith(broken))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.board.strings[0].slack).toBe(1)
    expect(result.board.strings[0].labelAt).toBe(0)
  })
})

describe('naming the file', () => {
  it('names it after the first page', () => {
    expect(boardFileName(tinyBoard())).toBe('a-page.json')
  })

  it('falls back to a name when there is no page to borrow one from', () => {
    expect(boardFileName({ entities: [], strings: [] })).toBe(DEFAULT_BOARD_FILE_NAME)
  })

  it('turns a title with punctuation in it into something a filesystem takes', () => {
    const board = tinyBoard()
    const article = { ...board.entities[0], title: "The Harbormaster's Ledger!" }
    expect(boardFileName({ ...board, entities: [article, board.entities[1]] })).toBe(
      'the-harbormaster-s-ledger.json',
    )
  })
})
