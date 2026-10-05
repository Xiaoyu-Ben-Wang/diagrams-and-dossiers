/**
 * Rotation about a pin.
 *
 * An image and an article are both sheets held to the board by one pin — the
 * tack at the top of a photograph, the tab at the head of a page — and both
 * swing about it. The physics is the reason: something hanging from a single
 * point turns about that point, not about its middle, and a sheet that rotated
 * about its centre would slide its pin out from under itself.
 *
 * Angle is in degrees, clockwise on screen, because that is what CSS
 * `rotate()` means and what a drag to the right should do. The sign convention
 * only holds because screen y points down; these are not maths-textbook angles
 * and are not meant to be.
 */

import type { Rect } from './camera'
import type { Point } from './yarn'

/**
 * How far a sheet may be swung, either way.
 *
 * A limit rather than free rotation because the tilt is meant to read as "this
 * was pinned up in a hurry", not as a layout tool: past about this much the
 * paper stops looking pinned and starts looking like it is falling off. It is
 * also what keeps a sheet's text within reach of a reader's neck.
 */
export const MAX_TILT_DEG = 45

/** Hold an angle inside the swing a pinned sheet is allowed. */
export function clampTilt(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0
  return Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, degrees))
}

/** Turn a point about a pivot, clockwise on screen, in degrees. */
export function rotateAbout(pivot: Point, point: Point, degrees: number): Point {
  if (!degrees) return point
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - pivot.x
  const dy = point.y - pivot.y
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  }
}

/**
 * The upright corners of a sheet, in the sheet's own space.
 *
 * `board` is the top-left the sheet is drawn from, which is what every kind
 * stores; the pivot is given in that same space so the caller can say "the
 * top-centre" without this needing to know what a sheet is for.
 */
function corners(board: Point, size: { width: number; height: number }): Point[] {
  return [
    { x: board.x, y: board.y },
    { x: board.x + size.width, y: board.y },
    { x: board.x + size.width, y: board.y + size.height },
    { x: board.x, y: board.y + size.height },
  ]
}

/**
 * The axis-aligned box a tilted sheet sweeps out.
 *
 * A marquee has to enclose what is *drawn*, and a tilted sheet covers more
 * ground than an upright one — a landscape photograph turned 45° is a good deal
 * wider than it is. Bounding the upright box instead lets a tilted image escape
 * the rubber band that visibly surrounds it.
 */
export function sweptBounds(
  board: Point,
  size: { width: number; height: number },
  pivot: Point,
  degrees: number,
): Rect {
  const points = corners(board, size).map((corner) => rotateAbout(pivot, corner, degrees))
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  }
}

/**
 * The tilt that would swing a sheet's topmost point onto the given direction.
 *
 * Read as "the pointer is *there*, so the sheet's head points *there*". A
 * sheet's head sits above its pivot, at `pivot + (0, -r)`; turning that by θ
 * (see `rotateAbout`) puts it at `pivot + (r·sinθ, -r·cosθ)`. Solving for θ
 * gives `atan2(dx, -dy)` — the negated `dy` is the whole of the sign convention,
 * and it is load-bearing: screen y runs downward, so without it the sheet turns
 * away from the hand.
 *
 * Degenerate at the pivot itself, where there is no direction to read; the
 * caller keeps whatever angle it had.
 */
export function tiltAngle(pivot: Point, point: Point): number {
  const dx = point.x - pivot.x
  const dy = point.y - pivot.y
  if (dx === 0 && dy === 0) return 0
  return (Math.atan2(dx, -dy) * 180) / Math.PI
}

/**
 * The tilt a rotation drag is asking for.
 *
 * The angle the handle was grabbed at is subtracted, so the sheet does not jump
 * to meet the pointer on the first frame: the handle keeps the offset it was
 * picked up with and the sheet turns by however much the hand has turned since.
 * The tilt the sheet already had is added back for the same reason — grabbing a
 * sheet that is already at 30° and moving two degrees must leave it at 32°, not
 * snap it to 2°.
 */
export function tiltTowards(
  pivot: Point,
  pointer: Point,
  grabbedAt: number,
  startTilt: number,
): number {
  let delta = tiltAngle(pivot, pointer) - grabbedAt
  // Both angles are wrapped to (-180, 180], so a drag across the boundary
  // arrives as a swing of nearly a full turn rather than the degree or two the
  // hand actually moved. Fold the difference into the short way round.
  while (delta > 180) delta -= 360
  while (delta <= -180) delta += 360
  return clampTilt(startTilt + delta)
}
