// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import type { Camera } from './camera'
import { GridLayer } from './GridLayer'
import {
  GRID_BASE_SPACING,
  MAX_SCREEN_SPACING,
  MAX_VISIBLE_DOTS,
  MIN_SCREEN_SPACING,
  gridFrame,
  gridOffset,
  gridSpacing,
  visibleDotCount,
  type GridFrame,
} from './grid'

const VIEWPORT = { width: 1280, height: 800 }

/** The zoom range the board allows, sampled finely enough to cross every step. */
const ZOOM_SWEEP = Array.from({ length: 461 }, (_, i) => 0.2 + (i * 2.3) / 460)

/** Zoom values where the chosen step changes: the base step meets the band floor. */
const STEP_BOUNDARIES = [-2, -1, 0, 1].map(
  (octave) => (MIN_SCREEN_SPACING / GRID_BASE_SPACING) * 2 ** octave,
)

/** A camera away from the origin, so a grid that only works at 0,0 fails. */
function cameraAt(zoom: number): Camera {
  return { x: 137.5, y: -412.25, zoom }
}

function stepExponent(spacing: number): number {
  return Math.log2(spacing / GRID_BASE_SPACING)
}

/** Screen coordinates of the dot at (column, row) of a frame's lattice. */
function dotAt(frame: GridFrame, column: number, row: number): { x: number; y: number } {
  return {
    x: frame.offsetX + frame.tileSize / 2 + column * frame.tileSize,
    y: frame.offsetY + frame.tileSize / 2 + row * frame.tileSize,
  }
}

/** Whether a screen point sits exactly on a dot of a frame's lattice. */
function onLattice(frame: GridFrame, point: { x: number; y: number }, epsilon = 1e-6): boolean {
  const column = (point.x - (frame.offsetX + frame.tileSize / 2)) / frame.tileSize
  const row = (point.y - (frame.offsetY + frame.tileSize / 2)) / frame.tileSize
  return (
    Math.abs(column - Math.round(column)) < epsilon && Math.abs(row - Math.round(row)) < epsilon
  )
}

/** How far a background-position delta is from a whole-cell shift, in px. */
function fromWholeCells(delta: number, tileSize: number): number {
  return Math.min(
    Math.abs(delta),
    Math.abs(delta - tileSize),
    Math.abs(delta + tileSize),
  )
}

describe('gridSpacing', () => {
  it('returns the base spacing at zoom 1', () => {
    expect(gridSpacing(1, VIEWPORT)).toBe(GRID_BASE_SPACING)
  })

  it('always steps by a power-of-two multiple of the base', () => {
    for (const zoom of ZOOM_SWEEP) {
      const spacing = gridSpacing(zoom, VIEWPORT)
      const exponent = stepExponent(spacing)
      expect(Math.abs(exponent - Math.round(exponent))).toBeLessThan(1e-9)
      expect(spacing).toBeGreaterThan(0)
    }
  })

  it('keeps on-screen spacing inside the band across the zoom range', () => {
    for (const zoom of ZOOM_SWEEP) {
      const screenSpacing = gridSpacing(zoom, VIEWPORT) * zoom
      expect(screenSpacing).toBeGreaterThanOrEqual(MIN_SCREEN_SPACING - 1e-6)
      expect(screenSpacing).toBeLessThanOrEqual(MAX_SCREEN_SPACING + 1e-6)
    }
  })

  it('breathes wider as the camera pulls out', () => {
    expect(gridSpacing(0.2, VIEWPORT)).toBeGreaterThan(gridSpacing(1, VIEWPORT))
    expect(gridSpacing(1, VIEWPORT)).toBeGreaterThan(gridSpacing(2.5, VIEWPORT))
  })

  it('caps the dot count for a viewport no screen has', () => {
    const huge = { width: 10_000_000, height: 10_000_000 }

    for (const zoom of [0.2, 1, 2.5]) {
      const spacing = gridSpacing(zoom, huge)
      expect(Number.isFinite(spacing)).toBe(true)
      expect(visibleDotCount(huge, spacing * zoom)).toBeLessThanOrEqual(MAX_VISIBLE_DOTS)

      const exponent = stepExponent(spacing)
      expect(Math.abs(exponent - Math.round(exponent))).toBeLessThan(1e-9)
    }
  })

  it('survives a zoom that is zero or not a number', () => {
    expect(gridSpacing(0, VIEWPORT)).toBeGreaterThan(0)
    expect(gridSpacing(Number.NaN, VIEWPORT)).toBeGreaterThan(0)
  })
})

describe('gridOffset', () => {
  it('lands on the last grid point at or before the camera', () => {
    expect(gridOffset({ x: 100, y: -70, zoom: 1 }, 24)).toEqual({ x: 96, y: -72 })
  })

  it('stays less than one step behind the camera', () => {
    for (const zoom of ZOOM_SWEEP) {
      const camera = cameraAt(zoom)
      const offset = gridOffset(camera, gridSpacing(zoom, VIEWPORT))

      expect(camera.x - offset.x).toBeGreaterThanOrEqual(0)
      expect(camera.x - offset.x).toBeLessThan(gridSpacing(zoom, VIEWPORT))
      expect(camera.y - offset.y).toBeGreaterThanOrEqual(0)
      expect(camera.y - offset.y).toBeLessThan(gridSpacing(zoom, VIEWPORT))
    }
  })

  it('anchors every step to the board origin', () => {
    const camera = cameraAt(1)

    for (const spacing of [6, 12, 24, 48, 96, 192]) {
      const offset = gridOffset(camera, spacing)
      expect(offset.x / spacing).toBe(Math.round(offset.x / spacing))
      expect(offset.y / spacing).toBe(Math.round(offset.y / spacing))
    }
  })
})

describe('gridFrame', () => {
  it('puts a dot on the board origin under the identity camera', () => {
    const frame = gridFrame({ x: 0, y: 0, zoom: 1 }, VIEWPORT)

    expect(frame.spacing).toBe(GRID_BASE_SPACING)
    expect(frame.tileSize).toBe(GRID_BASE_SPACING)
    expect(onLattice(frame, { x: 0, y: 0 })).toBe(true)
  })

  it('keeps a dot under the same board point at every zoom', () => {
    // Points on every possible step's lattice: all steps in the camera's range
    // divide 192, so each of these must land on a dot at every zoom.
    const boardPoints = [
      { x: 0, y: 0 },
      { x: 192, y: 192 },
      { x: -960, y: 384 },
    ]

    for (const zoom of ZOOM_SWEEP) {
      const camera = cameraAt(zoom)
      const frame = gridFrame(camera, VIEWPORT)

      for (const point of boardPoints) {
        const screen = { x: (point.x - camera.x) * zoom, y: (point.y - camera.y) * zoom }
        expect(onLattice(frame, screen)).toBe(true)
      }
    }
  })

  it('does not slide a surviving dot when the step changes', () => {
    for (const boundary of STEP_BOUNDARIES) {
      const before = gridFrame(cameraAt(boundary - 1e-9), VIEWPORT)
      const after = gridFrame(cameraAt(boundary + 1e-9), VIEWPORT)
      expect(after.spacing).not.toBe(before.spacing)

      const [fine, coarse] = after.spacing < before.spacing ? [after, before] : [before, after]

      for (let column = -2; column <= 2; column++) {
        for (let row = -2; row <= 2; row++) {
          expect(onLattice(fine, dotAt(coarse, column, row), 1e-3)).toBe(true)
        }
      }
    }
  })

  it('moves the tile origin continuously between step changes', () => {
    // Well inside one step's zoom range (5/6 … 5/3), so a jump here would be a
    // phase break, not a step change. A real break would move dots by half a
    // tile; the tolerance only has to absorb floating-point drift.
    let previous = gridFrame(cameraAt(0.9), VIEWPORT)

    for (let zoom = 0.90001; zoom <= 1.6; zoom += 1e-4) {
      const frame = gridFrame(cameraAt(zoom), VIEWPORT)
      expect(frame.spacing).toBe(previous.spacing)

      expect(fromWholeCells(frame.offsetX - previous.offsetX, frame.tileSize)).toBeLessThan(0.05)
      expect(fromWholeCells(frame.offsetY - previous.offsetY, frame.tileSize)).toBeLessThan(0.05)

      previous = frame
    }
  })

  it('never lets the background position escape one cell', () => {
    for (const zoom of ZOOM_SWEEP) {
      const frame = gridFrame(cameraAt(zoom), VIEWPORT)

      expect(frame.offsetX).toBeGreaterThanOrEqual(0)
      expect(frame.offsetX).toBeLessThan(frame.tileSize)
      expect(frame.offsetY).toBeGreaterThanOrEqual(0)
      expect(frame.offsetY).toBeLessThan(frame.tileSize)
    }
  })

  it('reports the dot count it will paint', () => {
    const huge = { width: 10_000_000, height: 10_000_000 }
    const frame = gridFrame({ x: 0, y: 0, zoom: 1 }, huge)

    expect(frame.dots).toBeLessThanOrEqual(MAX_VISIBLE_DOTS)
    expect(frame.dots).toBe(visibleDotCount(huge, frame.tileSize))
  })
})

describe('visibleDotCount', () => {
  it('counts the cells a viewport needs', () => {
    expect(visibleDotCount({ width: 100, height: 50 }, 25)).toBe(15)
  })

  it('falls as the spacing grows', () => {
    const dense = visibleDotCount(VIEWPORT, 20)
    const sparse = visibleDotCount(VIEWPORT, 40)

    expect(dense).toBeGreaterThan(sparse)
    expect(sparse).toBeGreaterThan(visibleDotCount(VIEWPORT, 80))
  })

  it('is unbounded when the spacing is not positive', () => {
    expect(visibleDotCount(VIEWPORT, 0)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('GridLayer', () => {
  function renderLayer(camera: Camera): HTMLElement {
    const { container } = render(createElement(GridLayer, { camera, viewport: VIEWPORT }))
    expect(container.children).toHaveLength(1)
    return container.firstElementChild as HTMLElement
  }

  it('renders one background element sized from the camera', () => {
    const layer = renderLayer({ x: 0, y: 0, zoom: 1 })

    expect(layer.getAttribute('data-testid')).toBe('board-grid')
    expect(layer.style.backgroundSize).toBe('24px 24px')
    // Half a cell in from the origin, so the dot sits on the board origin.
    expect(layer.style.backgroundPosition).toBe('12px 12px')
  })

  it('takes its background position from the frame', () => {
    const camera = cameraAt(2.5)
    const frame = gridFrame(camera, VIEWPORT)
    const layer = renderLayer(camera)

    expect(layer.style.backgroundSize).toBe(`${frame.tileSize}px ${frame.tileSize}px`)
    expect(layer.style.backgroundPosition).toBe(`${frame.offsetX}px ${frame.offsetY}px`)
  })
})
