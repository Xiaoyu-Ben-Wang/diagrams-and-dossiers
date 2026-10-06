import { describe, expect, it } from 'vitest'

import {
  boardToScreen,
  camerasDiffer,
  centreOn,
  easeInOut,
  fitBounds,
  IDENTITY_CAMERA,
  isVisible,
  lerpCamera,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  rectFromPoints,
  rectsIntersect,
  screenToBoard,
  unionRect,
  zoomAt,
  type Camera,
} from './camera'

const viewport = { width: 1000, height: 800 }

describe('coordinate conversion', () => {
  const camera: Camera = { x: 100, y: 50, zoom: 2 }

  it('maps the camera origin to the viewport origin', () => {
    expect(boardToScreen(camera, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 })
  })

  it('scales board distance by zoom', () => {
    expect(boardToScreen(camera, { x: 200, y: 50 })).toEqual({ x: 200, y: 0 })
  })

  it('round-trips through screen space', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 137, y: -42 },
      { x: -500, y: 900 },
    ]) {
      const screen = boardToScreen(camera, point)
      const back = screenToBoard(camera, screen)
      expect(back.x).toBeCloseTo(point.x, 9)
      expect(back.y).toBeCloseTo(point.y, 9)
    }
  })
})

describe('unionRect', () => {
  it('returns null for nothing', () => {
    expect(unionRect([])).toBeNull()
  })

  it('covers every rect', () => {
    const union = unionRect([
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 200, y: 100, width: 100, height: 100 },
    ])
    expect(union).toEqual({ x: 0, y: 0, width: 300, height: 200 })
  })

  it('handles negative coordinates', () => {
    const union = unionRect([
      { x: -100, y: -50, width: 100, height: 50 },
      { x: 0, y: 0, width: 100, height: 50 },
    ])
    expect(union).toEqual({ x: -100, y: -50, width: 200, height: 100 })
  })

  it('includes zero-size rects rather than ignoring them', () => {
    const union = unionRect([{ x: 10, y: 10, width: 0, height: 0 }])
    expect(union).toEqual({ x: 10, y: 10, width: 0, height: 0 })
  })
})

describe('fitBounds', () => {
  it('returns null when there is nothing to frame', () => {
    expect(fitBounds([], viewport)).toBeNull()
  })

  it('centres a target in the viewport', () => {
    const camera = fitBounds([{ x: 0, y: 0, width: 200, height: 200 }], viewport, 0)!
    const centre = boardToScreen(camera, { x: 100, y: 100 })
    expect(centre.x).toBeCloseTo(viewport.width / 2, 6)
    expect(centre.y).toBeCloseTo(viewport.height / 2, 6)
  })

  it('zooms out far enough to fit the target plus padding', () => {
    const target = { x: 0, y: 0, width: 2000, height: 1000 }
    const camera = fitBounds([target], viewport, 50)!

    expect(target.width * camera.zoom).toBeLessThanOrEqual(viewport.width - 100 + 0.001)
    expect(target.height * camera.zoom).toBeLessThanOrEqual(viewport.height - 100 + 0.001)
  })

  it('fits the constraining dimension exactly', () => {
    const camera = fitBounds([{ x: 0, y: 0, width: 900, height: 100 }], viewport, 50)!
    expect(900 * camera.zoom).toBeCloseTo(viewport.width - 100, 6)
  })

  it('frames several targets together', () => {
    const camera = fitBounds(
      [
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 900, y: 700, width: 100, height: 100 },
      ],
      viewport,
      0,
    )!
    const centre = boardToScreen(camera, { x: 500, y: 400 })
    expect(centre.x).toBeCloseTo(viewport.width / 2, 6)
    expect(centre.y).toBeCloseTo(viewport.height / 2, 6)
  })

  it('centres a zero-size target instead of dividing by zero', () => {
    const camera = fitBounds([{ x: 500, y: 500, width: 0, height: 0 }], viewport)!
    expect(camera.zoom).toBe(1)
    const centre = boardToScreen(camera, { x: 500, y: 500 })
    expect(centre.x).toBeCloseTo(viewport.width / 2, 6)
  })

  it('clamps zoom to the allowed range', () => {
    const tiny = fitBounds([{ x: 0, y: 0, width: 1, height: 1 }], viewport)!
    expect(tiny.zoom).toBeLessThanOrEqual(MAX_ZOOM)

    const huge = fitBounds([{ x: 0, y: 0, width: 1e9, height: 1e9 }], viewport)!
    expect(huge.zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
  })
})

describe('zoomAt', () => {
  const camera: Camera = { x: 0, y: 0, zoom: 1 }

  it('keeps the board point under the cursor fixed', () => {
    const cursor = { x: 700, y: 300 }
    const before = screenToBoard(camera, cursor)
    const after = screenToBoard(zoomAt(camera, cursor, 2.4), cursor)

    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('holds the cursor point across a zoom out as well', () => {
    const zoomed: Camera = { x: 120, y: -80, zoom: 2 }
    const cursor = { x: 250, y: 640 }
    const before = screenToBoard(zoomed, cursor)
    const after = screenToBoard(zoomAt(zoomed, cursor, 0.6), cursor)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('clamps beyond the allowed range', () => {
    expect(zoomAt(camera, { x: 0, y: 0 }, 99).zoom).toBe(MAX_ZOOM)
    expect(zoomAt(camera, { x: 0, y: 0 }, 0.001).zoom).toBe(MIN_ZOOM)
  })
})

describe('panBy', () => {
  it('moves the board opposite the drag, as if dragging the paper', () => {
    const panned = panBy(IDENTITY_CAMERA, 50, 0)
    expect(panned.x).toBe(-50)
  })

  it('converts screen distance to board distance at the current zoom', () => {
    const panned = panBy({ x: 0, y: 0, zoom: 2 }, 100, 0)
    expect(panned.x).toBe(-50)
  })

  it('leaves zoom untouched', () => {
    expect(panBy({ x: 0, y: 0, zoom: 1.7 }, 10, 10).zoom).toBe(1.7)
  })
})

describe('lerpCamera', () => {
  const from: Camera = { x: 0, y: 0, zoom: 1 }
  const to: Camera = { x: 100, y: 200, zoom: 4 }

  it('returns the endpoints exactly', () => {
    expect(lerpCamera(from, to, 0)).toEqual(from)
    expect(lerpCamera(from, to, 1)).toEqual(to)
  })

  it('interpolates zoom geometrically, not linearly', () => {
    const middle = lerpCamera(from, to, 0.5)
    expect(middle.zoom).toBeCloseTo(2, 6)
  })

  it('reaches the same visual rate throughout the move', () => {
    const a = lerpCamera(from, to, 0.25).zoom
    const b = lerpCamera(from, to, 0.5).zoom
    const c = lerpCamera(from, to, 0.75).zoom
    expect(b / a).toBeCloseTo(c / b, 6)
  })

  it('clamps out-of-range t', () => {
    expect(lerpCamera(from, to, -5)).toEqual(from)
    expect(lerpCamera(from, to, 5)).toEqual(to)
  })
})

describe('easeInOut', () => {
  it('is pinned at both ends', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
  })

  it('is symmetric about the midpoint', () => {
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 9)
    expect(easeInOut(0.25) + easeInOut(0.75)).toBeCloseTo(1, 9)
  })

  it('starts and ends slowly', () => {
    expect(easeInOut(0.1)).toBeLessThan(0.1)
    expect(easeInOut(0.9)).toBeGreaterThan(0.9)
  })
})

describe('camerasDiffer', () => {
  it('treats sub-pixel differences as identical', () => {
    expect(camerasDiffer({ x: 0, y: 0, zoom: 1 }, { x: 0.1, y: 0, zoom: 1 })).toBe(false)
  })

  it('notices a real move', () => {
    expect(camerasDiffer({ x: 0, y: 0, zoom: 1 }, { x: 40, y: 0, zoom: 1 })).toBe(true)
    expect(camerasDiffer({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0, zoom: 1.5 })).toBe(true)
  })
})

describe('rectFromPoints', () => {
  it('normalises corners given in any order', () => {
    const expected = { x: 10, y: 20, width: 30, height: 40 }
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual(expected)
    expect(rectFromPoints({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual(expected)
  })

  it('never produces a negative extent', () => {
    const rect = rectFromPoints({ x: 100, y: 100 }, { x: 20, y: 30 })
    expect(rect.width).toBeGreaterThanOrEqual(0)
    expect(rect.height).toBeGreaterThanOrEqual(0)
  })

  it('handles a rect collapsed to a point', () => {
    expect(rectFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    })
  })
})

describe('rectsIntersect', () => {
  const box = { x: 0, y: 0, width: 100, height: 100 }

  it('detects an overlap', () => {
    expect(rectsIntersect(box, { x: 50, y: 50, width: 100, height: 100 })).toBe(true)
  })

  it('detects containment either way round', () => {
    expect(rectsIntersect(box, { x: 10, y: 10, width: 10, height: 10 })).toBe(true)
    expect(rectsIntersect({ x: 10, y: 10, width: 10, height: 10 }, box)).toBe(true)
  })

  it('rejects a rect that misses entirely', () => {
    expect(rectsIntersect(box, { x: 200, y: 200, width: 10, height: 10 })).toBe(false)
  })

  it('rejects a rect that only aligns on one axis', () => {
    expect(rectsIntersect(box, { x: 50, y: 500, width: 10, height: 10 })).toBe(false)
  })

  it('counts touching edges as intersecting', () => {
    expect(rectsIntersect(box, { x: 100, y: 0, width: 10, height: 10 })).toBe(true)
  })

  it('catches a zero-size rect whose point is inside', () => {
    // A pin has no area but must still be pickable by a marquee.
    expect(rectsIntersect(box, { x: 50, y: 50, width: 0, height: 0 })).toBe(true)
  })

  it('misses a zero-size rect whose point is outside', () => {
    expect(rectsIntersect(box, { x: 500, y: 50, width: 0, height: 0 })).toBe(false)
  })
})

describe('isVisible', () => {
  const camera: Camera = { x: 0, y: 0, zoom: 1 }

  it('sees a rect inside the viewport', () => {
    expect(isVisible({ x: 100, y: 100, width: 50, height: 50 }, camera, viewport, 0)).toBe(true)
  })

  it('culls a rect well outside it', () => {
    expect(isVisible({ x: 5000, y: 5000, width: 50, height: 50 }, camera, viewport, 0)).toBe(false)
  })

  it('keeps a rect just off-screen but within the margin, so panning is not cliff-edged', () => {
    const justOff = { x: -120, y: 100, width: 50, height: 50 }
    expect(isVisible(justOff, camera, viewport, 200)).toBe(true)
    expect(isVisible(justOff, camera, viewport, 0)).toBe(false)
  })

  it('accounts for zoom', () => {
    const far = { x: 1500, y: 100, width: 50, height: 50 }
    expect(isVisible(far, camera, viewport, 0)).toBe(false)
    expect(isVisible(far, { x: 0, y: 0, zoom: 0.5 }, viewport, 0)).toBe(true)
  })
})

describe('centring on something', () => {
  const viewport = { width: 1000, height: 600 }

  it('puts the rect in the middle without changing the zoom', () => {
    const camera = centreOn({ x: 2000, y: 1000, width: 400, height: 200 }, viewport, 0.75)

    expect(camera.zoom).toBe(0.75)
    const onScreen = boardToScreen(camera, { x: 2200, y: 1100 })
    expect(onScreen.x).toBeCloseTo(500, 6)
    expect(onScreen.y).toBeCloseTo(300, 6)
  })

  it('centres a point, which is what a pin box is', () => {
    const camera = centreOn({ x: 100, y: 50, width: 0, height: 0 }, viewport, 1)
    expect(boardToScreen(camera, { x: 100, y: 50 })).toEqual({ x: 500, y: 300 })
  })

  it('clamps a zoom the board would not allow', () => {
    expect(centreOn({ x: 0, y: 0, width: 10, height: 10 }, viewport, 99).zoom).toBe(MAX_ZOOM)
    expect(centreOn({ x: 0, y: 0, width: 10, height: 10 }, viewport, 0.001).zoom).toBe(MIN_ZOOM)
  })

  it('works in negative board space, where a page dragged up and left lives', () => {
    const camera = centreOn({ x: -900, y: -400, width: 200, height: 100 }, viewport, 1)
    expect(boardToScreen(camera, { x: -800, y: -350 })).toEqual({ x: 500, y: 300 })
  })
})
