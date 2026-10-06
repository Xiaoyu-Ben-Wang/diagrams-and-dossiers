import { describe, expect, it } from 'vitest'

import {
  clampTilt,
  MAX_TILT_DEG,
  rotateAbout,
  sweptBounds,
  tiltAngle,
  tiltTowards,
} from './pivot'

describe('rotateAbout', () => {
  it('leaves the pivot where it is', () => {
    const pivot = { x: 30, y: 40 }

    for (const degrees of [-45, -20, 0, 7, 45]) {
      const turned = rotateAbout(pivot, pivot, degrees)
      expect(turned.x).toBeCloseTo(pivot.x, 9)
      expect(turned.y).toBeCloseTo(pivot.y, 9)
    }
  })

  it('turns clockwise on screen for a positive angle', () => {
    // Screen y runs downward; this matches CSS `rotate()`, which the renderer relies on.
    const turned = rotateAbout({ x: 0, y: 0 }, { x: 10, y: 0 }, 90)

    expect(turned.x).toBeCloseTo(0, 9)
    expect(turned.y).toBeCloseTo(10, 9)
  })

  it('preserves distance from the pivot', () => {
    const pivot = { x: 100, y: 100 }
    const point = { x: 160, y: 130 }
    const before = Math.hypot(point.x - pivot.x, point.y - pivot.y)

    for (const degrees of [-45, 30, 45]) {
      const turned = rotateAbout(pivot, point, degrees)
      expect(Math.hypot(turned.x - pivot.x, turned.y - pivot.y)).toBeCloseTo(before, 9)
    }
  })

  it('is the identity at zero', () => {
    const point = { x: 5, y: 9 }
    expect(rotateAbout({ x: 0, y: 0 }, point, 0)).toEqual(point)
  })
})

describe('sweptBounds', () => {
  const size = { width: 200, height: 100 }
  const board = { x: 0, y: 0 }
  const pivot = { x: 100, y: 0 }

  it('is the upright box when nothing is turned', () => {
    expect(sweptBounds(board, size, pivot, 0)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    })
  })

  it('hangs the sheet below the pin once it is swung', () => {
    const at45 = sweptBounds(board, size, pivot, 45)

    expect(at45.y + at45.height).toBeGreaterThan(100)
  })

  it('reaches above the pin as well, because the far corner lifts', () => {
    const at45 = sweptBounds(board, size, pivot, 45)

    expect(at45.y).toBeCloseTo(-100 * Math.SQRT1_2, 6)
  })

  it('always contains the pivot', () => {
    for (const degrees of [-45, -30, 0, 30, 45]) {
      const box = sweptBounds(board, size, pivot, degrees)
      expect(pivot.x).toBeGreaterThanOrEqual(box.x)
      expect(pivot.x).toBeLessThanOrEqual(box.x + box.width)
      expect(pivot.y).toBeGreaterThanOrEqual(box.y)
      expect(pivot.y).toBeLessThanOrEqual(box.y + box.height)
    }
  })

  it('is symmetric about the pin at opposite angles', () => {
    const left = sweptBounds(board, size, pivot, -30)
    const right = sweptBounds(board, size, pivot, 30)

    expect(left.y).toBeCloseTo(right.y, 6)
    expect(left.width).toBeCloseTo(right.width, 6)
    expect(left.height).toBeCloseTo(right.height, 6)
    expect(left.x + left.width - pivot.x).toBeCloseTo(pivot.x - right.x, 6)
  })
})

describe('clampTilt', () => {
  it('holds the sheet inside its swing', () => {
    expect(clampTilt(90)).toBe(MAX_TILT_DEG)
    expect(clampTilt(-90)).toBe(-MAX_TILT_DEG)
    expect(clampTilt(20)).toBe(20)
  })

  it('treats a non-finite angle as no tilt rather than as a wild one', () => {
    expect(clampTilt(Number.NaN)).toBe(0)
    expect(clampTilt(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('tiltAngle', () => {
  const pivot = { x: 0, y: 0 }

  it('reads a pointer above the pin as no tilt', () => {
    expect(tiltAngle(pivot, { x: 0, y: -50 })).toBeCloseTo(0, 9)
  })

  it('reads a pointer to the right as a quarter turn clockwise', () => {
    expect(tiltAngle(pivot, { x: 50, y: 0 })).toBeCloseTo(90, 9)
  })

  it('reads a pointer below as half a turn', () => {
    // Without the negated `dy` this reads as zero and the sheet turns away from the hand.
    expect(Math.abs(tiltAngle(pivot, { x: 0, y: 50 }))).toBeCloseTo(180, 9)
  })

  it('reads a pointer to the left as a quarter turn the other way', () => {
    expect(tiltAngle(pivot, { x: -50, y: 0 })).toBeCloseTo(-90, 9)
  })

  it('has no direction to read at the pivot itself', () => {
    expect(tiltAngle(pivot, pivot)).toBe(0)
  })
})

describe('tiltTowards', () => {
  const pivot = { x: 0, y: 0 }

  it('turns by however much the hand turned, not to where the hand is', () => {
    const grabbed = tiltAngle(pivot, { x: 0, y: -50 })

    expect(tiltTowards(pivot, rotateAbout(pivot, { x: 0, y: -50 }, 20), grabbed, 10)).toBeCloseTo(30, 6)
  })

  it('lets a sheet grabbed at a tilt keep that tilt when the hand does not move', () => {
    const start = { x: 30, y: -40 }
    const grabbed = tiltAngle(pivot, start)

    expect(tiltTowards(pivot, start, grabbed, 25)).toBeCloseTo(25, 6)
  })

  it('clamps a swing that would go past the sheet limit', () => {
    const grabbed = tiltAngle(pivot, { x: 0, y: -50 })

    expect(tiltTowards(pivot, { x: 50, y: 0 }, grabbed, 0)).toBe(MAX_TILT_DEG)
    expect(tiltTowards(pivot, { x: -50, y: 0 }, grabbed, 0)).toBe(-MAX_TILT_DEG)
  })

  it('takes the short way round the wrap, not the long one', () => {
    // A hand crossing the ±180 line has moved two degrees, not 358 the other way.
    const justLeft = { x: -1, y: -50 }
    const justRight = { x: 1, y: -50 }
    const grabbed = tiltAngle(pivot, justLeft)

    const result = tiltTowards(pivot, justRight, grabbed, 0)

    expect(Math.abs(result)).toBeLessThan(5)
  })
})
