/**
 * The entity registry: one descriptor per kind.
 *
 * Before this, "what can a pin do?" and "where is a note?" were answered by
 * `if` branches scattered through `App.tsx` — three of them in the drag router,
 * a parallel loop per kind in the marquee, the selection move and zoom-to-fit,
 * and two position representations resolved by a branch inside `pinPoint`.
 * Adding a kind meant finding all of them.
 *
 * Here each kind answers for itself, so the call sites become one loop over
 * entities and the differences between kinds live in one place. That is what
 * makes a kind *configurable* rather than merely present: changing how notes
 * are hit-tested, or giving images a rotation, is an edit to one descriptor and
 * not a hunt through the component.
 *
 * Descriptors are pure. Anything a kind cannot know alone — where an article's
 * content box sits, where a quote resolved to — arrives through `EntityContext`
 * rather than being read from the DOM here.
 *
 * ## Where `board` points
 *
 * The kinds do not agree on what their `board` coordinate means, and rather
 * than pretend otherwise this is where the disagreement is written down:
 *
 *   pin      the CENTRE of the tack (a tack is a point, not a box)
 *   note     the TOP-LEFT of the note, as post-its have always been drawn
 *   article  the TOP-LEFT of the sheet
 *   image    the TOP-LEFT of the image, with its pivot at top-centre
 *
 * Normalising them would be tidier and would also move every existing entity
 * on screen by half a box. Each descriptor owns its own convention instead, and
 * `bounds`/`anchorPoint` are the only places that need to know it.
 */

import type { AnchorRect } from '../anchors/dom'
import { sweptBounds } from '../board/pivot'
import type { Rect } from '../board/camera'
import type { Point } from '../board/yarn'
import {
  isAnchoredPin,
  type BoardEntity,
  type EntityContext,
  type EntityKind,
} from './types'

/** A tack's footprint, and half of it — the offset from centre to corner. */
export const TACK_SIZE = 14
export const TACK_RADIUS = TACK_SIZE / 2
/** The offsets an anchored tack is drawn at relative to the words it holds. */
export const TACK_OFFSET_X = -6
export const TACK_OFFSET_Y = -5

/** A post-it's footprint. Shared by the renderer and by the marquee. */
export const NOTE_SIZE = { width: 168, height: 128 } as const

/** An image's default footprint, in board px, before it is cropped to fit. */
export const IMAGE_SIZE = { width: 260, height: 200 } as const

/** Half-extent of a free pin's footprint, which is just a tack. */
export const PIN_RADIUS = 10

/**
 * What a kind can be asked to do.
 *
 * Each flag is consulted somewhere real; none is decorative. `marqueeSelectable`
 * is separate from `movable` because they genuinely differ for a pin: a tack in
 * the cork can be rubber-banded, and a tack in a word cannot (there is nothing
 * of it on the board to enclose), yet both can be repositioned.
 */
export interface EntityCapabilities {
  /** Picked up by a rubber-band selection dragged across the board. */
  marqueeSelectable: boolean
  /** Repositioned by a board-space delta — a drag, a nudge, or a middle-drag. */
  movable: boolean
  /** Yarn may attach to it. */
  connectable: boolean
  /** Contributes an entry to the chronology. */
  dated: boolean
  /** Has an angle the user can set. */
  rotatable: boolean
  /** Has a body the user can edit in place. */
  editable: boolean
}

export interface EntityDescriptor<E extends BoardEntity> {
  kind: E['kind']
  capabilities(entity: E): EntityCapabilities
  /**
   * The board-space point this entity is pinned by, where yarn attaches, or
   * null when it has no resolvable place — an anchored pin whose quote is gone.
   */
  anchorPoint(entity: E, context: EntityContext): Point | null
  /** Board-space footprint, for hit-testing a rubber band. */
  bounds(entity: E, context: EntityContext): Rect | null
  /**
   * The box zoom-to-fit should frame. Defaults to `bounds`.
   *
   * A pin overrides it because its hit footprint is a single point, and a
   * zero-size box contributes nothing to a fit — the board would frame its
   * notes and crop the tacks holding them.
   */
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
    // A tack in a word is drawn inside the paper, not loose on the board, so a
    // rubber band dragged across the cork has nothing of it to enclose.
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
    // Through the article's own mapping rather than by adding its corner: the
    // tack is stuck through the paper, so it turns with the paper, and the
    // nudge is an offset against those words rather than against the board.
    return context.articleToBoard(entity.articleId, {
      x: tack.x + entity.nudge.x,
      y: tack.y + entity.nudge.y,
    })
  },
  bounds: (entity, context) => {
    const at = pin.anchorPoint(entity, context)
    if (!at) return null
    // A point, not a box: a tack has no area to intersect.
    return { x: at.x, y: at.y, width: 0, height: 0 }
  },
  frameBounds: (entity, context) => {
    const at = pin.anchorPoint(entity, context)
    if (!at) return null
    // But it does have a size once you want to look at it.
    return {
      x: at.x - PIN_RADIUS,
      y: at.y - PIN_RADIUS,
      width: PIN_RADIUS * 2,
      height: PIN_RADIUS * 2,
    }
  },
  move: (entity, delta) =>
    isAnchoredPin(entity)
      ? // A tack's place is derived from its words, so the shift is kept as an
        // offset against them. It still belongs to the quote and follows it.
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
    // Strings meet a note in the middle of it; its corner is where it is drawn
    // from, which is not the same thing.
    x: entity.board.x + NOTE_SIZE.width / 2 + entity.nudge.x,
    y: entity.board.y + NOTE_SIZE.height / 2 + entity.nudge.y,
  }),
  bounds: (entity) => boxAt(entity.board, NOTE_SIZE),
  move: (entity, delta) => ({
    ...entity,
    board: { x: entity.board.x + delta.x, y: entity.board.y + delta.y },
  }),
}

const article: EntityDescriptor<BoardEntity & { kind: 'article' }> = {
  kind: 'article',
  capabilities: (entity) => ({
    marqueeSelectable: true,
    movable: true,
    connectable: true,
    dated: true,
    rotatable: false,
    // A sheet is edited through its own editor, which the options can forbid.
    editable: entity.options.editable,
  }),
  anchorPoint: (entity, context) => {
    const size = context.articleSize(entity.id)
    if (!size) return null
    // The tab at the top of the sheet, which is where a string would be tied.
    return { x: entity.board.x + size.width / 2 + entity.nudge.x, y: entity.board.y }
  },
  bounds: (entity, context) => {
    const size = context.articleSize(entity.id)
    return size ? boxAt(entity.board, size) : null
  },
  move: (entity, delta) => ({
    ...entity,
    board: { x: entity.board.x + delta.x, y: entity.board.y + delta.y },
  }),
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
  anchorPoint: (entity) => ({
    // The tack it hangs from, which is also the point it turns about.
    x: entity.board.x + entity.width / 2 + entity.nudge.x,
    y: entity.board.y + entity.nudge.y,
  }),
  bounds: (entity) => {
    // Rotation grows the footprint, so the marquee uses the swept box rather
    // than the upright one — otherwise a tilted photo escapes the band that
    // visibly encloses it.
    //
    // About the top-centre, not the middle. Rotating the bounding box of the
    // upright picture would sweep a box the picture never occupies and miss the
    // part of the real sweep that hangs past the pivot.
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

/**
 * The descriptor for an entity.
 *
 * Generic in the entity so the returned descriptor is typed for that variant —
 * `descriptorFor(note)` accepts a note in `move` and not the whole union.
 */
export function descriptorFor<E extends BoardEntity>(entity: E): EntityDescriptor<E> {
  return DESCRIPTORS[entity.kind] as EntityDescriptor<E>
}

/** The descriptor for a kind, when there is no instance to hand. */
export function descriptorOf(kind: EntityKind): EntityDescriptor<BoardEntity> {
  return DESCRIPTORS[kind] as EntityDescriptor<BoardEntity>
}
