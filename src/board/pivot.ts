import type { Rect } from './camera'
import type { Point } from './yarn'

export const MAX_TILT_DEG = 45

export function clampTilt(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0
  return Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, degrees))
}

/** Degrees, clockwise on screen (y points down), matching CSS `rotate()`. */
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

function corners(board: Point, size: { width: number; height: number }): Point[] {
  return [
    { x: board.x, y: board.y },
    { x: board.x + size.width, y: board.y },
    { x: board.x + size.width, y: board.y + size.height },
    { x: board.x, y: board.y + size.height },
  ]
}

/** Axis-aligned box of the tilted sheet, which a marquee must enclose. */
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

/** The sheet's head points at `point`; the negated `dy` is the screen-y-down sign convention. */
export function tiltAngle(pivot: Point, point: Point): number {
  const dx = point.x - pivot.x
  const dy = point.y - pivot.y
  if (dx === 0 && dy === 0) return 0
  return (Math.atan2(dx, -dy) * 180) / Math.PI
}

export function tiltTowards(
  pivot: Point,
  pointer: Point,
  grabbedAt: number,
  startTilt: number,
): number {
  let delta = tiltAngle(pivot, pointer) - grabbedAt
  // Both angles wrap at ±180, so fold the delta into the short way round.
  while (delta > 180) delta -= 360
  while (delta <= -180) delta += 360
  return clampTilt(startTilt + delta)
}
