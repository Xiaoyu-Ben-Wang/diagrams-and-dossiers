import { describe, expect, it } from 'vitest'

import { tAt } from './StringNote'
import { pointOnYarn } from './yarn'

const from = { x: 0, y: 0 }
const to = { x: 200, y: 0 }
const slack = 0.18

describe('tAt', () => {
  it('reads a point at one end as that end', () => {
    expect(tAt(from, to, pointOnYarn(from, to, 0, slack), slack)).toBeCloseTo(0, 1)
    expect(tAt(from, to, pointOnYarn(from, to, 1, slack), slack)).toBeCloseTo(1, 1)
  })

  it('reads the middle of the rope as the middle of the string', () => {
    // The midpoint of the *curve*, not of the chord: with slack the rope hangs,
    // and a note placed halfway along it is below the straight line.
    expect(tAt(from, to, pointOnYarn(from, to, 0.5, slack), slack)).toBeCloseTo(0.5, 1)
  })

  it('projects a point near the rope onto it', () => {
    const on = pointOnYarn(from, to, 0.75, slack)
    const off = { x: on.x, y: on.y + 6 }

    expect(tAt(from, to, off, slack)).toBeCloseTo(0.75, 1)
  })

  it('never leaves the rope, however far off the point is', () => {
    // The whole reason the slide projects rather than applying a delta: the
    // answer is always a place on the string, so a note cannot be dragged off
    // the end of it or across to the far side of the sag.
    for (const point of [{ x: -900, y: 400 }, { x: 900, y: -400 }, { x: 100, y: 900 }]) {
      const t = tAt(from, to, point, slack)
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThanOrEqual(1)
    }
  })

  it('gives a usable place for a string with no length', () => {
    // Two pins on the same spot: there is no rope to hang a note on, and the
    // middle is the only answer that is not a division by nothing.
    expect(tAt(from, from, { x: 0, y: 0 }, slack)).toBe(0.5)
  })

  it('moves the same way along the rope as the pointer does', () => {
    const early = tAt(from, to, pointOnYarn(from, to, 0.2, slack), slack)
    const late = tAt(from, to, pointOnYarn(from, to, 0.8, slack), slack)

    expect(late).toBeGreaterThan(early)
  })
})
