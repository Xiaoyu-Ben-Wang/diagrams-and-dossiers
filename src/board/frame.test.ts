import { describe, expect, it } from 'vitest'

import { NO_RECTS, frameTargets } from './frame'
import type { ArticleEntity, BoardEntity, EntityContext, ImageEntity, NoteEntity } from '../model/types'

const base = {
  bodyMd: '',
  visibility: 'shared' as const,
  status: 'theory' as const,
  dateInherit: true,
  nudge: { x: 0, y: 0 },
  zIndex: 0,
  version: 1,
  createdAt: 0,
  updatedAt: 0,
}

const note = (over: Partial<NoteEntity> = {}): NoteEntity => ({
  ...base,
  id: 'n1',
  kind: 'note',
  board: { x: 10, y: 20 },
  width: 168,
  height: 128,
  fontScale: 1,
  ...over,
})

const article = (over: Partial<ArticleEntity> = {}): ArticleEntity => ({
  ...base,
  id: 'a1',
  kind: 'article',
  board: { x: 0, y: 0 },
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
  ...over,
})

const image = (over: Partial<ImageEntity> = {}): ImageEntity => ({
  ...base,
  id: 'i1',
  kind: 'image',
  board: { x: 50, y: 60 },
  src: 'data:image/png;base64,AAAA',
  width: 120,
  height: 90,
  fit: 'cover',
  rotation: 0,
  edge: 'clean',
  edgeSeed: 1,
  ...over,
})

const context = (size: { width: number; height: number } | null): EntityContext => ({
  articleToBoard: () => null,
  anchorRect: () => null,
  articleSize: () => size,
})

const at = (entities: BoardEntity[], size: { width: number; height: number } | null = { width: 720, height: 400 }) =>
  frameTargets(entities, context(size))

describe('what the board is, as boxes', () => {
  it('gives one box per entity that has a footprint', () => {
    expect(at([note(), image()])).toHaveLength(2)
  })

  it('uses the frame box where a kind has one, not the drawn box', () => {
    // A rotated picture's footprint is the box it sweeps, not the rectangle it
    // would occupy upright — otherwise a fit-to-board crops its corners.
    const upright = at([image()])[0]!
    const tilted = at([image({ rotation: 45 })])[0]!

    expect(tilted.width).toBeGreaterThan(upright.width)
    expect(tilted.x).toBeLessThan(upright.x)
  })

  it('leaves out a page nothing has measured yet', () => {
    // A page's height is whatever its text takes, so before layout there is no
    // box to frame — which in jsdom is always.
    expect(at([article()], null)).toHaveLength(0)
    expect(at([article()])).toHaveLength(1)
  })

  it('is empty for an empty board', () => {
    expect(at([])).toEqual([])
  })

  it('hands back a stable empty list, so a memo on it does not re-run', () => {
    expect(NO_RECTS).toHaveLength(0)
  })
})
