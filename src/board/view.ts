/**
 * What the board draws, and the small geometry that turns what it stores into
 * what it paints.
 *
 * The board's *data* is an entity list — a pin is an anchor and a nudge, a
 * note is a corner. What the board *renders* is a different shape: a pin needs
 * a resolved rectangle before it has anywhere to be, and a string needs both
 * its ends in board space before it has a curve. `PinView` is that second
 * shape, and the projection effect is what produces it.
 *
 * These lived in `App.tsx` because they are small and only it used them. They
 * are here because the components that draw things need them now, and a
 * component that has to be handed a callback into the middle of a two-thousand
 * line file is a component that cannot be moved.
 */

import type { AnchorRect } from '../anchors/dom'
import type { Point } from './yarn'

/**
 * A pin, once its words have been found.
 *
 * The board stores an anchor — a quote and its surroundings — and the geometry
 * exists only after that quote has been resolved against the article as it is
 * right now. So this carries the answer rather than the question, and it is
 * rebuilt whenever the article, the pins or the fonts change.
 */
export interface PinView {
  id: string
  quote: string
  body: string
  /**
   * Manual offset from wherever the pin would otherwise sit, in board space.
   * An anchored pin's position is derived from the words it holds, so nudging
   * it is stored as a delta rather than by overwriting a position it does not
   * really have.
   */
  nudge: Point
  /** 'free' is a pin stuck straight into the board rather than into text. */
  status: 'exact' | 'repaired' | 'orphaned' | 'free'
  detail: string
  /** In-world date, shown in the hover card. */
  dateLabel: string
  /** Position within the paper, for a pin anchored to text. */
  rect: AnchorRect | null
  /** Position in board space, for a pin stuck into the board itself. */
  board: Point | null
}

/** A string with both ends resolved to board points, ready to draw or pick. */
export interface DrawableString {
  id: string
  slack: number
  from: Point
  to: Point
}

/**
 * The offsets a tack is drawn at, relative to the top-left of the words it
 * holds. Half the tack's width to the right, a touch above the line, so the
 * pin reads as pinning the *end* of the quotation rather than sitting on top of
 * the words.
 */
const TACK_OFFSET_X = -6
const TACK_OFFSET_Y = -5
const TACK_RADIUS = 7

/** Where a tack sits within the words it holds, in the article's own space. */
export function tackPoint(rect: AnchorRect): Point {
  return { x: rect.x + rect.width + TACK_OFFSET_X + TACK_RADIUS, y: rect.y + TACK_OFFSET_Y + TACK_RADIUS }
}

/**
 * Where a pin's tack sits in BOARD space.
 *
 * `articleToBoard` is the article's own mapping rather than its corner: a tack
 * is stuck *through* the page, so it turns with the page, and a sheet that has
 * been swung no longer relates its corner to its pin in a way anything can add
 * to. Free pins are already board coordinates and ignore it. Returning null for
 * an orphaned pin keeps a string to something that no longer exists out of the
 * render rather than drawing it to the origin.
 */
export function pinPoint(
  pin: PinView,
  articleToBoard: (local: Point) => Point,
): Point | null {
  if (pin.rect) {
    const tack = tackPoint(pin.rect)
    return articleToBoard({ x: tack.x + pin.nudge.x, y: tack.y + pin.nudge.y })
  }
  if (pin.board) return { x: pin.board.x + pin.nudge.x, y: pin.board.y + pin.nudge.y }
  return null
}

/**
 * Whether a point lies within `slack` of a rect, on either axis.
 *
 * Used to decide that a pin dropped just off its word is still being adjusted
 * rather than re-pinned. The slack is passed already divided by the zoom, so
 * the forgiveness is a constant distance on screen rather than one that grows
 * as the board is zoomed in.
 */
export function withinSlop(point: Point, rect: AnchorRect, slack: number): boolean {
  return (
    point.x >= rect.x - slack &&
    point.x <= rect.x + rect.width + slack &&
    point.y >= rect.y - slack &&
    point.y <= rect.y + rect.height + slack
  )
}

/**
 * The entity an element belongs to, if any.
 *
 * Hit-testing stays in the DOM — the canvas reports whatever element was under
 * the pointer and has no idea what the application calls it — so this is the one
 * place a node becomes an id. Being the only such place is what lets the drag
 * router, the context menu and the middle-drag all stop naming kinds.
 *
 * The older per-kind attributes are still honoured rather than renamed in one
 * go: they are load-bearing for a lot of tests, and a rename is a churn with no
 * behaviour behind it.
 */
export function entityIdFromElement(element: Element): string | null {
  return (
    element.closest('[data-entity-id]')?.getAttribute('data-entity-id') ??
    element.closest('[data-pin-id]')?.getAttribute('data-pin-id') ??
    element.closest('[data-post-it-id]')?.getAttribute('data-post-it-id') ??
    null
  )
}

/**
 * A computed-style length as a number of px.
 *
 * jsdom has no layout engine and reports these as empty strings, so a bare
 * parseFloat would poison board coordinates with NaN and every string would
 * render as "M NaN NaN".
 */
export function px(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}
