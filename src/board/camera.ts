/**
 * The board camera.
 *
 * Three coordinate spaces, kept strictly separate:
 *
 *   board space   — the infinite canvas. Items and articles live here.
 *   screen space  — viewport pixels.
 *   paper space   — inside one rendered article, where text anchors resolve.
 *
 *     screen = (board − camera) × zoom
 *
 * Everything here is pure arithmetic over that one transform. That matters
 * because the timeline drives the camera directly: scrubbing the chronology
 * flies the viewport to a moment, and it must do so without touching any item's
 * stored position. Pins don't move when you scrub; the camera does.
 *
 * Zoom is applied as a single CSS transform on the board container, so text
 * metrics inside an article never change with zoom — which is what keeps text
 * anchors stable (see `projection.ts`).
 */

import type { Point } from './yarn'

export interface Camera {
  /** Board-space coordinate rendered at the viewport's top-left. */
  x: number
  y: number
  zoom: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 2.5

/** Breathing room left around the target when framing content, in screen px. */
export const DEFAULT_PADDING = 64

export const IDENTITY_CAMERA: Camera = { x: 0, y: 0, zoom: 1 }

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function boardToScreen(camera: Camera, point: Point): Point {
  return {
    x: (point.x - camera.x) * camera.zoom,
    y: (point.y - camera.y) * camera.zoom,
  }
}

export function screenToBoard(camera: Camera, point: Point): Point {
  return {
    x: point.x / camera.zoom + camera.x,
    y: point.y / camera.zoom + camera.y,
  }
}

/**
 * Total board-space rectangle covering every rect, or null for an empty list.
 *
 * Zero-size rects are included deliberately — an article placed on the board
 * before it has been measured is still a thing worth framing.
 */
export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * A camera that frames every target with padding.
 *
 * This is what the timeline calls when you scrub: gather the items active at
 * that moment, frame them, animate the camera there. An empty list means "frame
 * nothing", so the camera is returned unchanged rather than flying to 0,0.
 */
export function fitBounds(
  targets: Rect[],
  viewport: Viewport,
  padding: number = DEFAULT_PADDING,
): Camera | null {
  const bounds = unionRect(targets)
  if (!bounds) return null

  const availableWidth = Math.max(1, viewport.width - padding * 2)
  const availableHeight = Math.max(1, viewport.height - padding * 2)

  // A single point, or a zero-size rect, has no scale to fit — fall back to
  // identity zoom so we centre it rather than dividing by zero.
  const zoom =
    bounds.width <= 0 || bounds.height <= 0
      ? 1
      : clampZoom(
          Math.min(availableWidth / bounds.width, availableHeight / bounds.height),
        )

  const centreX = bounds.x + bounds.width / 2
  const centreY = bounds.y + bounds.height / 2

  return {
    x: centreX - viewport.width / (2 * zoom),
    y: centreY - viewport.height / (2 * zoom),
    zoom,
  }
}

/**
 * A camera that puts `rect` in the middle of the viewport, at a zoom you name.
 *
 * The difference from `fitBounds` is the whole point of it: this one does not
 * choose a scale. Following a mention to a page should not rescale the board —
 * the camera keeps the size it had, so the board does not lurch and you keep
 * your sense of where things are — whereas `fitBounds` picks a zoom that frames
 * the target, which for a post-it means filling the screen with one post-it.
 *
 * The two agree on the arithmetic, and the zoom is clamped here rather than
 * assumed to have been clamped upstream.
 */
export function centreOn(rect: Rect, viewport: Viewport, zoom: number): Camera {
  const scale = clampZoom(zoom)
  return {
    x: rect.x + rect.width / 2 - viewport.width / (2 * scale),
    y: rect.y + rect.height / 2 - viewport.height / (2 * scale),
    zoom: scale,
  }
}

/**
 * Zoom while keeping the board point under `screenPoint` pinned to the cursor.
 *
 * Without this, zooming drifts towards the viewport's origin and the thing you
 * were looking at slides away — the single most common way a canvas feels bad.
 */
export function zoomAt(camera: Camera, screenPoint: Point, nextZoom: number): Camera {
  const zoom = clampZoom(nextZoom)
  const anchor = screenToBoard(camera, screenPoint)
  return {
    x: anchor.x - screenPoint.x / zoom,
    y: anchor.y - screenPoint.y / zoom,
    zoom,
  }
}

/** Pan by a screen-space delta (a drag), converted at the current zoom. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return {
    x: camera.x - dx / camera.zoom,
    y: camera.y - dy / camera.zoom,
    zoom: camera.zoom,
  }
}

/** How far apart two cameras are, for deciding whether a move is worth animating. */
export function camerasDiffer(a: Camera, b: Camera, epsilon = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) > epsilon ||
    Math.abs(a.y - b.y) > epsilon ||
    Math.abs(a.zoom - b.zoom) > 0.001
  )
}

/**
 * Linear interpolation between cameras.
 *
 * Zoom is interpolated *geometrically* rather than linearly. Linear zoom looks
 * wrong on a long move: the first half covers most of the visual distance and
 * the tail crawls. Interpolating in log space makes the perceived rate constant,
 * which is what a camera move should feel like.
 */
export function lerpCamera(from: Camera, to: Camera, t: number): Camera {
  const eased = t < 0 ? 0 : t > 1 ? 1 : t
  const zoom = from.zoom * Math.pow(to.zoom / from.zoom, eased)
  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
    zoom,
  }
}

/** Smoothstep, for easing a camera move without pulling in an animation library. */
export function easeInOut(t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  return clamped * clamped * (3 - 2 * clamped)
}

/**
 * The rect spanned by two corners, in any order.
 *
 * Marquee selection produces corners in whatever order the pointer travelled,
 * so normalising here keeps "drag up and to the left" from producing a
 * negative-width rect that intersects nothing.
 */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

/**
 * Whether two rects overlap at all.
 *
 * Touching edges count as intersecting, and a zero-size rect — a pin, which has
 * no extent of its own — is inside a marquee when its point is. That is the
 * behaviour you want: dragging a box across a pin should pick it up even though
 * the pin has no area.
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  )
}

/**
 * Whether a board-space rect is worth rendering.
 *
 * Culling by AABB is what keeps a board with hundreds of pins smooth — and it
 * beats DOM virtualization here, because `content-visibility: auto` makes
 * `getBoundingClientRect()` return skipped-layout values, which would break the
 * anchor measurement this whole design rests on.
 */
export function isVisible(
  rect: Rect,
  camera: Camera,
  viewport: Viewport,
  margin = 200,
): boolean {
  const topLeft = boardToScreen(camera, { x: rect.x, y: rect.y })
  const width = rect.width * camera.zoom
  const height = rect.height * camera.zoom

  return (
    topLeft.x + width >= -margin &&
    topLeft.y + height >= -margin &&
    topLeft.x <= viewport.width + margin &&
    topLeft.y <= viewport.height + margin
  )
}
