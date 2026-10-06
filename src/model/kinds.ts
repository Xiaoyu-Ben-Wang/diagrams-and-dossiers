// `board` differs by kind: pin is the tack centre, note/article the top-left, image the
// top-left with its pivot at top-centre. Do not normalise — it would move every entity.

import type { AnchorRect } from '../anchors/dom'
import { rotateAbout, sweptBounds } from '../board/pivot'
import type { Rect } from '../board/camera'
import type { Point } from '../board/yarn'
import {
  isAnchoredPin,
  type BoardEntity,
  type EntityContext,
  type EntityKind,
} from './types'

export const TACK_SIZE = 14
export const TACK_RADIUS = TACK_SIZE / 2
/** Where the anchored tack is drawn relative to the words it holds. */
export const TACK_OFFSET_X = -6
export const TACK_OFFSET_Y = -5

/** A post-it's default footprint; the size actually lives on the entity. */
export const NOTE_SIZE = { width: 168, height: 128 } as const

export const NOTE_FONT_SIZE = 12
export const NOTE_FONT_SCALE_MIN = 0.75
export const NOTE_FONT_SCALE_MAX = 2
export const NOTE_FONT_SCALE_STEP = 0.125
export const NOTE_FONT_SCALE_DEFAULT = 1

/** Steps from the floor, not by adding, so up-then-down does not drift off the scale. */
export function stepFontScale(scale: number, direction: 1 | -1): number {
  const steps = Math.round((scale - NOTE_FONT_SCALE_MIN) / NOTE_FONT_SCALE_STEP)
  const next = NOTE_FONT_SCALE_MIN + (steps + direction) * NOTE_FONT_SCALE_STEP
  const clamped = Math.min(NOTE_FONT_SCALE_MAX, Math.max(NOTE_FONT_SCALE_MIN, next))
  return Math.round(clamped * 1000) / 1000
}

/** Default footprint in board px. */
export const IMAGE_SIZE = { width: 260, height: 200 } as const

/** Half-extent of a free pin's footprint, which is just a tack. */
export const PIN_RADIUS = 10

/** How far inside a picture's top edge its pin sits, in board px — enough to fit the whole tack. */
export const IMAGE_PIN_INSET = 10

/** `marqueeSelectable` differs from `movable`: an in-text tack can move but not be band-selected. */
export interface EntityCapabilities {
  marqueeSelectable: boolean
  movable: boolean
  connectable: boolean
  dated: boolean
  rotatable: boolean
  editable: boolean
}

export interface EntityDescriptor<E extends BoardEntity> {
  kind: E['kind']
  capabilities(entity: E): EntityCapabilities
  /** The point yarn attaches to, or null when it has no resolvable place. */
  anchorPoint(entity: E, context: EntityContext): Point | null
  /** Board-space footprint, for hit-testing a rubber band. */
  bounds(entity: E, context: EntityContext): Rect | null
  /** Zoom-to-fit box; pins override it, since a zero-size box contributes nothing to a fit. */
  frameBounds?(entity: E, context: EntityContext): Rect | null
  /** Apply a board-space delta. Returns the same entity when it cannot move. */
  move(entity: E, delta: Point): E
}

/** The tack's centre, in an article's own coordinates. */
export function tackPoint(rect: AnchorRect): Point {
  return {
    x: rect.x + rect.width + TACK_OFFSET_X + TACK_RADIUS,
    y: rect.y + TACK_OFFSET_Y + TACK_RADIUS,
  }
}

const boxAt = (point: Point, size: { width: number; height: number }): Rect => ({
  x: point.x,
  y: point.y,
  width: size.width,
  height: size.height,
})

const pin: EntityDescriptor<BoardEntity & { kind: 'pin' }> = {
  kind: 'pin',
  capabilities: (entity) => ({
    marqueeSelectable: !isAnchoredPin(entity),
    movable: true,
    connectable: true,
    dated: true,
    rotatable: false,
    editable: true,
  }),
  anchorPoint: (entity, context) => {
    if (!isAnchoredPin(entity)) {
      return {
        x: entity.board.x + entity.nudge.x,
        y: entity.board.y + entity.nudge.y,
      }
    }
    const rect = context.anchorRect(entity.id)
    if (!rect) return null
    const tack = tackPoint(rect)
    // Through the article's mapping, not its corner: the tack turns with the paper, and
    // the nudge is an offset against those words rather than against the board.
    return context.articleToBoard(entity.articleId, {
      x: tack.x + entity.nudge.x,
      y: tack.y + entity.nudge.y,
    })
  },
  bounds: (entity, context) => {
    const at = pin.anchorPoint(entity, context)
    if (!at) return null
    return { x: at.x, y: at.y, width: 0, height: 0 }
  },
  frameBounds: (entity, context) => {
    const at = pin.anchorPoint(entity, context)
    if (!at) return null
    return {
      x: at.x - PIN_RADIUS,
      y: at.y - PIN_RADIUS,
      width: PIN_RADIUS * 2,
      height: PIN_RADIUS * 2,
    }
  },
  move: (entity, delta) =>
    isAnchoredPin(entity)
      ? // The shift is kept as a nudge against the words, so the tack follows them.
        { ...entity, nudge: { x: entity.nudge.x + delta.x, y: entity.nudge.y + delta.y } }
      : { ...entity, board: { x: entity.board.x + delta.x, y: entity.board.y + delta.y } },
}

const note: EntityDescriptor<BoardEntity & { kind: 'note' }> = {
  kind: 'note',
  capabilities: () => ({
    marqueeSelectable: true,
    movable: true,
    connectable: true,
    dated: true,
    rotatable: false,
    editable: true,
  }),
  anchorPoint: (entity) => ({
    // Top-centre, not the centre: rope over the writing, and the centre moves when
    // the note is resized, sliding a tied string down the paper.
    x: entity.board.x + entity.width / 2 + entity.nudge.x,
    y: entity.board.y + entity.nudge.y,
  }),
  bounds: (entity) => boxAt(entity.board, { width: entity.width, height: entity.height }),
  move: (entity, delta) => ({
    ...entity,
    board: { x: entity.board.x + delta.x, y: entity.board.y + delta.y },
  }),
}

const article: EntityDescriptor<BoardEntity & { kind: 'article' }> = {
  kind: 'article',
  capabilities: (entity) => ({
    // Out of the rubber band: a page swept into a selection is dragged off, leaving its pins.
    marqueeSelectable: false,
    movable: true,
    connectable: true,
    dated: true,
    rotatable: true,
    editable: entity.options.editable,
  }),
  anchorPoint: (entity) => {
    // The tab: the swing pivot, so no angle belongs in this sum. Reads the entity's own
    // width, not the measurement, so yarn can tie before layout — and agrees with `articleToBoard`.
    return { x: entity.board.x + entity.options.width / 2 + entity.nudge.x, y: entity.board.y }
  },
  bounds: (entity, context) => {
    const size = context.articleSize(entity.id)
    if (!size) return null
    return sweptBounds(
      entity.board,
      size,
      { x: entity.board.x + size.width / 2, y: entity.board.y },
      entity.rotation,
    )
  },
  move: (entity, delta) => ({
    ...entity,
    board: { x: entity.board.x + delta.x, y: entity.board.y + delta.y },
  }),
}

/** The inset pin is measured inside the sheet, so it must be turned with it. */
function imagePin(entity: BoardEntity & { kind: 'image' }): Point {
  const pivot = { x: entity.board.x + entity.width / 2, y: entity.board.y }
  const turned = rotateAbout(
    pivot,
    { x: pivot.x, y: entity.board.y + IMAGE_PIN_INSET },
    entity.rotation,
  )
  return { x: turned.x + entity.nudge.x, y: turned.y + entity.nudge.y }
}

const image: EntityDescriptor<BoardEntity & { kind: 'image' }> = {
  kind: 'image',
  capabilities: () => ({
    marqueeSelectable: true,
    movable: true,
    connectable: true,
    dated: true,
    rotatable: true,
    editable: true,
  }),
  anchorPoint: (entity) => {
    return imagePin(entity)
  },
  bounds: (entity) => {
    // Swept about the top-centre, not the middle: rotation grows the footprint, and a
    // tilted photo would otherwise escape the band that visibly encloses it.
    const size = { width: entity.width, height: entity.height }
    return sweptBounds(
      entity.board,
      size,
      { x: entity.board.x + entity.width / 2, y: entity.board.y },
      entity.rotation,
    )
  },
  move: (entity, delta) => ({
    ...entity,
    board: { x: entity.board.x + delta.x, y: entity.board.y + delta.y },
  }),
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the table is keyed by
   kind and each entry is typed for its own variant; the union of them is what
   callers see, and `descriptorFor` narrows to match. */
const DESCRIPTORS: { [K in EntityKind]: EntityDescriptor<any> } = {
  pin,
  note,
  article,
  image,
}

export function descriptorFor<E extends BoardEntity>(entity: E): EntityDescriptor<E> {
  return DESCRIPTORS[entity.kind] as EntityDescriptor<E>
}

export function descriptorOf(kind: EntityKind): EntityDescriptor<BoardEntity> {
  return DESCRIPTORS[kind] as EntityDescriptor<BoardEntity>
}
