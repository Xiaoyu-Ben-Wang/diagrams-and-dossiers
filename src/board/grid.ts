import type { Camera, Viewport } from './camera'
import type { Point } from './yarn'

/** Board-space spacing between dots at zoom 1. */
export const GRID_BASE_SPACING = 24

/** The band the on-screen dot spacing is kept inside, in CSS px. */
export const MIN_SCREEN_SPACING = 20
export const MAX_SCREEN_SPACING = 40

export const MAX_VISIBLE_DOTS = 40_000

const MAX_STEP_EXPONENT = 48

function positiveZoom(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}

export function visibleDotCount(viewport: Viewport, screenSpacing: number): number {
  if (!(screenSpacing > 0)) return Number.POSITIVE_INFINITY

  const columns = Math.ceil(viewport.width / screenSpacing) + 1
  const rows = Math.ceil(viewport.height / screenSpacing) + 1
  return columns * rows
}

/** Steps are power-of-two multiples of the base, anchored to the board origin, so a dot that survives a step change never moves. */
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

/** The grid point at or before the camera's top-left corner. */
export function gridOffset(camera: Camera, spacing: number): Point {
  return {
    x: Math.floor(camera.x / spacing) * spacing,
    y: Math.floor(camera.y / spacing) * spacing,
  }
}

export interface GridFrame {
  /** Board-space distance between dots. */
  spacing: number
  /** On-screen repeat cell — the CSS `background-size`. */
  tileSize: number
  /** CSS `background-position`, in [0, tileSize). */
  offsetX: number
  offsetY: number
  /** Dots the viewport paints at this spacing. */
  dots: number
}

export function gridFrame(camera: Camera, viewport: Viewport): GridFrame {
  const zoom = positiveZoom(camera.zoom)
  const spacing = gridSpacing(zoom, viewport)
  const tileSize = spacing * zoom
  const anchor = gridOffset(camera, spacing)

  return {
    spacing,
    tileSize,
    // The dot renders at the cell's centre, so the cell starts half a cell short of the anchor dot.
    offsetX: wrap((anchor.x - camera.x) * zoom - tileSize / 2, tileSize),
    offsetY: wrap((anchor.y - camera.y) * zoom - tileSize / 2, tileSize),
    dots: visibleDotCount(viewport, tileSize),
  }
}

function wrap(value: number, m: number): number {
  return ((value % m) + m) % m
}
