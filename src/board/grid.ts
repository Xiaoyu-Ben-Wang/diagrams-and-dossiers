/**
 * The board's dot grid.
 *
 * A grid fixed in board space alone breaks at the ends of the camera range: at
 * 0.2× its dots merge into a grey wash, at 2.5× a handful of giant dots fill
 * the viewport. The fix is the one mapping libraries use for scale bars — keep
 * the grid anchored to board space, but step its SPACING by powers of two so
 * the on-screen spacing stays inside a comfortable band at every zoom.
 *
 * The powers of two are load-bearing rather than tidy. A dot must sit under the
 * same point of the paper at every zoom; dots may appear or vanish when the
 * step changes, but a dot that survives must not move. That holds exactly when
 * every step is anchored to the board origin and one step divides the next —
 * the coarse lattice is then a subset of the fine one. Any other ratio slides
 * every dot sideways the instant the step changes.
 *
 * All of this is arithmetic over the camera. The component only formats the
 * result into two CSS properties.
 */

import type { Camera, Viewport } from './camera'
import type { Point } from './yarn'

/** Board-space spacing between dots at zoom 1. */
export const GRID_BASE_SPACING = 24

/** The band the on-screen dot spacing is kept inside, in CSS px. */
export const MIN_SCREEN_SPACING = 20
export const MAX_SCREEN_SPACING = 40

/**
 * Ceiling on the dots a single frame may paint. The band already bounds density
 * for any real screen — a 4K viewport at the floor spacing is still under this
 * — so the cap only trips on a viewport nothing sensible has. When it does, the
 * step doubles until the count fits: a coarser grid rather than a slower one.
 */
export const MAX_VISIBLE_DOTS = 40_000

/** Bounds the exponent so no caller can ask for 2^1000 board units. */
const MAX_STEP_EXPONENT = 48

/** A camera's zoom is clamped upstream; this is the belt for a direct caller. */
function positiveZoom(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}

/** How many dots a viewport paints at this on-screen spacing. */
export function visibleDotCount(viewport: Viewport, screenSpacing: number): number {
  if (!(screenSpacing > 0)) return Number.POSITIVE_INFINITY

  const columns = Math.ceil(viewport.width / screenSpacing) + 1
  const rows = Math.ceil(viewport.height / screenSpacing) + 1
  return columns * rows
}

/**
 * The board-space spacing to use: always a power-of-two multiple of the base.
 *
 * The chosen step is the smallest one whose on-screen size clears the band
 * floor. The band is exactly one octave wide, so that same step cannot
 * overshoot the ceiling — which is why no hysteresis is needed here.
 */
export function gridSpacing(zoom: number, viewport: Viewport): number {
  const z = positiveZoom(zoom)

  const exponent = Math.ceil(Math.log2(MIN_SCREEN_SPACING / (GRID_BASE_SPACING * z)))
  let spacing =
    GRID_BASE_SPACING * 2 ** Math.max(-MAX_STEP_EXPONENT, Math.min(MAX_STEP_EXPONENT, exponent))

  for (let step = 0; step < MAX_STEP_EXPONENT; step++) {
    if (visibleDotCount(viewport, spacing * z) <= MAX_VISIBLE_DOTS) break
    spacing *= 2
  }

  return spacing
}

/**
 * The grid's board-space phase: the grid point at or before the camera's
 * top-left corner.
 *
 * Anchoring to the board origin — which is a multiple of every step, since each
 * step is a power-of-two multiple of the base — rather than to the camera is
 * what makes a step change invisible to dots that survive it. A camera-anchored
 * grid slides by half a step at every change.
 */
export function gridOffset(camera: Camera, spacing: number): Point {
  return {
    x: Math.floor(camera.x / spacing) * spacing,
    y: Math.floor(camera.y / spacing) * spacing,
  }
}

export interface GridFrame {
  /** Board-space distance between dots. */
  spacing: number
  /** On-screen edge of one repeat cell — the CSS `background-size`. */
  tileSize: number
  /** On-screen cell origin — the CSS `background-position`, in [0, tileSize). */
  offsetX: number
  offsetY: number
  /** Dots the viewport paints at this spacing. */
  dots: number
}

/** The screen-space numbers the CSS background needs. */
export function gridFrame(camera: Camera, viewport: Viewport): GridFrame {
  const zoom = positiveZoom(camera.zoom)
  const spacing = gridSpacing(zoom, viewport)
  const tileSize = spacing * zoom
  const anchor = gridOffset(camera, spacing)

  return {
    spacing,
    tileSize,
    // The dot renders at the cell's centre, so the cell starts half a cell
    // short of the anchor dot. Wrapping keeps the numbers small for a camera
    // that has flown far from the origin; a whole cell of shift is invisible
    // when the background repeats.
    offsetX: wrap((anchor.x - camera.x) * zoom - tileSize / 2, tileSize),
    offsetY: wrap((anchor.y - camera.y) * zoom - tileSize / 2, tileSize),
    dots: visibleDotCount(viewport, tileSize),
  }
}

/** Modulo that lands in [0, m) for negative inputs too. */
function wrap(value: number, m: number): number {
  return ((value % m) + m) % m
}
