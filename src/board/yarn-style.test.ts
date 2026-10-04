import { describe, expect, it } from 'vitest'

import { DEFAULT_SLACK, distanceToYarn, pointOnYarn, yarnPath } from './yarn'
import type { Point } from './yarn'
import {
  DEFAULT_FUZZ,
  MAX_STRANDS,
  YARN_STYLES,
  clearYarnStyleCache,
  fuzzyStrands,
  maxStrandDeviation,
  seedFromKey,
  strandOffset,
  valueNoise,
  yarnStrands,
} from './yarn-style'

const FROM: Point = { x: 40, y: 120 }
const TO: Point = { x: 640, y: 300 }

/** Pull the vertices back out of the emitted path, in order. */
function vertices(d: string): Point[] {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g) ?? []
  const points: Point[] = []
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push({ x: Number(numbers[i]), y: Number(numbers[i + 1]) })
  }
  return points
}

describe('valueNoise', () => {
  it('repeats exactly for the same position and seed', () => {
    expect(valueNoise(3.14159, 7)).toBe(valueNoise(3.14159, 7))
    expect(valueNoise(-12.5, -3)).toBe(valueNoise(-12.5, -3))
  })

  it('separates neighbouring seeds', () => {
    const a = [0.5, 1.5, 2.5, 3.5].map((x) => valueNoise(x, 1))
    const b = [0.5, 1.5, 2.5, 3.5].map((x) => valueNoise(x, 2))
    expect(a).not.toEqual(b)
    // Independent fields should not merely differ, they should disagree in sign.
    expect(a.some((value, i) => Math.sign(value) !== Math.sign(b[i]))).toBe(true)
  })

  it('stays inside [-1, 1]', () => {
    for (let x = -50; x < 50; x += 0.13) {
      const value = valueNoise(x, 5)
      expect(value).toBeGreaterThanOrEqual(-1)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('is zero-mean over a long sweep', () => {
    let sum = 0
    let count = 0
    for (let x = 0; x < 400; x += 0.11) {
      sum += valueNoise(x, 9)
      count++
    }
    expect(Math.abs(sum / count)).toBeLessThan(0.05)
  })
})

describe('seedFromKey', () => {
  it('is stable across calls', () => {
    expect(seedFromKey('npc:marta->clue:ledger')).toBe(seedFromKey('npc:marta->clue:ledger'))
  })

  it('spreads distinct keys over distinct seeds', () => {
    const seeds = new Set(['a->b', 'a->c', 'b->c', 'x->y'].map(seedFromKey))
    expect(seeds.size).toBe(4)
  })
})

describe('strandOffset', () => {
  const count = DEFAULT_FUZZ.strands

  it('pins both ends exactly on the curve', () => {
    // Anything but an exact zero leaves the string floating off its tack.
    for (let s = 0; s < count; s++) {
      expect(strandOffset(0, s, count, 3)).toBe(0)
      expect(strandOffset(1, s, count, 3)).toBe(0)
    }
  })

  it('never pushes a filament past the documented deviation', () => {
    const bound = maxStrandDeviation()
    for (let s = 0; s < count; s++) {
      for (let i = 0; i <= 400; i++) {
        expect(Math.abs(strandOffset(i / 400, s, count, 3))).toBeLessThanOrEqual(bound)
      }
    }
  })

  it('changes smoothly along the string, with no spikes', () => {
    // A 1/128 step is far finer than the noise lattice, so a value noise field
    // can only move a small fraction of its amplitude across one step. A spike
    // would land near a full amplitude and blow this bound out.
    const step = 1 / 128
    let maxDelta = 0
    for (let s = 0; s < count; s++) {
      let previous = strandOffset(0, s, count, 3)
      for (let i = 1; i <= 128; i++) {
        const current = strandOffset(i * step, s, count, 3)
        maxDelta = Math.max(maxDelta, Math.abs(current - previous))
        previous = current
      }
    }
    expect(maxDelta).toBeLessThan(0.25 * DEFAULT_FUZZ.amplitude)
  })

  it('is roughly zero-mean, so the fuzz sits on the yarn rather than beside it', () => {
    let sum = 0
    let magnitude = 0
    let samples = 0
    for (let s = 0; s < count; s++) {
      for (let i = 1; i < 200; i++) {
        const offset = strandOffset(i / 200, s, count, 11)
        sum += offset
        magnitude += Math.abs(offset)
        samples++
      }
    }
    expect(Math.abs(sum / samples)).toBeLessThan(0.2 * DEFAULT_FUZZ.amplitude)
    // Guard against the field being null: there has to be real fuzz to average.
    expect(magnitude / samples).toBeGreaterThan(0.3 * DEFAULT_FUZZ.amplitude)
  })

  it('gives each filament its own field, so fibres cross instead of nesting', () => {
    // Concentric outlines are the failure mode this guards: if every filament
    // shared a field the fan would never reorder, and it would read as a rope.
    let crossings = 0
    for (let s = 0; s + 1 < count; s++) {
      let previousSign = 0
      for (let i = 1; i < 128; i++) {
        const t = i / 128
        const sign = Math.sign(strandOffset(t, s, count, 7) - strandOffset(t, s + 1, count, 7))
        if (sign !== 0 && previousSign !== 0 && sign !== previousSign) crossings++
        if (sign !== 0) previousSign = sign
      }
    }
    expect(crossings).toBeGreaterThan(0)
  })

  it('moves the whole fan when the seed changes', () => {
    const a = strandOffset(0.37, 1, count, 1)
    const b = strandOffset(0.37, 1, count, 2)
    expect(Math.abs(a - b)).toBeGreaterThan(0.05)
  })
})

describe('fuzzyStrands', () => {
  it('keeps the fan within the strand cap', () => {
    const strands = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 1)
    expect(strands.length).toBeLessThanOrEqual(MAX_STRANDS)
    expect(strands.length).toBeGreaterThan(2)

    const greedy = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 1, { strands: 99 })
    expect(greedy.length).toBe(MAX_STRANDS)

    const lonely = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 1, { strands: 0 })
    expect(lonely.length).toBe(1)
  })

  it('returns byte-identical output for the same seed', () => {
    const first = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 42)
    // Clearing the cache proves the determinism is in the maths, not the memo.
    clearYarnStyleCache()
    const second = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 42)
    expect(second.map((s) => s.d)).toEqual(first.map((s) => s.d))
    expect(second.map((s) => s.width)).toEqual(first.map((s) => s.width))
    expect(second.map((s) => s.opacity)).toEqual(first.map((s) => s.opacity))
  })

  it('actually re-fuzzes when the seed changes', () => {
    const one = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 1)
    const two = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 2)
    expect(two.map((s) => s.d)).not.toEqual(one.map((s) => s.d))
  })

  it('pins both ends of every filament to the endpoints', () => {
    const strands = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 5)
    for (const strand of strands) {
      const points = vertices(strand.d)
      // Path data is rounded to 2dp, so the tacks are met to within that
      // quantum — not merely somewhere within a pixel.
      expect(Math.abs(points[0].x - FROM.x)).toBeLessThanOrEqual(0.005)
      expect(Math.abs(points[0].y - FROM.y)).toBeLessThanOrEqual(0.005)
      expect(Math.abs(points[points.length - 1].x - TO.x)).toBeLessThanOrEqual(0.005)
      expect(Math.abs(points[points.length - 1].y - TO.y)).toBeLessThanOrEqual(0.005)
    }
  })

  it('bounds every drawn vertex by the documented deviation', () => {
    const bound = maxStrandDeviation()
    const strands = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 5)
    const steps = DEFAULT_FUZZ.samples - 1

    for (const strand of strands) {
      const points = vertices(strand.d)
      expect(points.length).toBe(DEFAULT_FUZZ.samples)
      points.forEach((point, i) => {
        const base = pointOnYarn(FROM, TO, i / steps, DEFAULT_SLACK)
        // The offset is applied along the normal, so this distance is the
        // offset itself — the fuzz cannot exceed its bound, and it cannot
        // wander off the curve even where the two ends are free.
        expect(Math.hypot(point.x - base.x, point.y - base.y)).toBeLessThanOrEqual(bound + 0.02)
      })
    }
  })

  it('does not wander from the base curve', () => {
    const strands = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 5)
    for (const strand of strands) {
      for (const point of vertices(strand.d)) {
        const near = distanceToYarn(FROM, TO, point, DEFAULT_SLACK, 400)
        expect(near.distance).toBeLessThan(maxStrandDeviation() + 1)
      }
    }
  })

  it('does not spike between adjacent vertices', () => {
    // A smooth perturbation bends a vertex only slightly more than the base
    // curve already does; a discontinuity would stand straight out of this.
    const strands = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 5)
    const steps = DEFAULT_FUZZ.samples - 1
    const base = (i: number) => pointOnYarn(FROM, TO, i / steps, DEFAULT_SLACK)

    for (const strand of strands) {
      const points = vertices(strand.d)
      for (let i = 1; i < points.length - 1; i++) {
        const bend = Math.hypot(
          points[i].x - (points[i - 1].x + points[i + 1].x) / 2,
          points[i].y - (points[i - 1].y + points[i + 1].y) / 2,
        )
        const previous = base(i - 1)
        const current = base(i)
        const next = base(i + 1)
        const baseBend = Math.hypot(
          current.x - (previous.x + next.x) / 2,
          current.y - (previous.y + next.y) / 2,
        )
        expect(bend).toBeLessThan(baseBend + DEFAULT_FUZZ.amplitude)
      }
    }
  })

  it('fades the outer fibres so the centre reads as the string', () => {
    const strands = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 5)
    const middle = (strands.length - 1) / 2
    for (let i = 1; i <= middle; i++) {
      expect(strands[i].width).toBeGreaterThan(strands[i - 1].width)
      expect(strands[i].opacity).toBeGreaterThan(strands[i - 1].opacity)
    }
    // The fan is symmetric about the curve, so opposite filaments match.
    expect(strands[middle - 1].width).toBeCloseTo(strands[middle + 1].width, 6)
    expect(strands[middle].opacity).toBeGreaterThan(0.8)
  })

  it('memoises identical geometry instead of rebuilding it', () => {
    clearYarnStyleCache()
    const first = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 8, { strands: 4 })
    const second = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 8, { strands: 4 })
    expect(second).toBe(first)

    // A moved pin, a new seed and a changed option must all miss.
    expect(fuzzyStrands({ ...FROM, x: FROM.x + 1 }, TO, DEFAULT_SLACK, 8, { strands: 4 })).not.toBe(first)
    expect(fuzzyStrands(FROM, TO, DEFAULT_SLACK, 9, { strands: 4 })).not.toBe(first)
    expect(fuzzyStrands(FROM, TO, DEFAULT_SLACK, 8, { strands: 6 })).not.toBe(first)
  })

  it('falls back to the defaults for a non-finite option', () => {
    // A preferences control with an emptied number box yields NaN. Clamping
    // passes that through, which would drop every filament (NaN count) or emit
    // "NaN" path data the browser refuses to draw.
    const strands = fuzzyStrands(FROM, TO, DEFAULT_SLACK, 1, {
      strands: Number.NaN,
      amplitude: Number.NaN,
      width: Number.NaN,
      samples: Number.NaN,
    })
    expect(strands.length).toBe(DEFAULT_FUZZ.strands)
    for (const strand of strands) {
      expect(strand.d).not.toMatch(/NaN/)
      expect(Number.isFinite(strand.width)).toBe(true)
      expect(Number.isFinite(strand.opacity)).toBe(true)
    }
  })
})

describe('yarnStrands', () => {
  it('draws minimal as the single clean stroke from yarn.ts', () => {
    const strands = yarnStrands('minimal', FROM, TO)
    expect(strands.length).toBe(1)
    expect(strands[0].d).toBe(yarnPath(FROM, TO))
    expect(strands[0].opacity).toBe(1)
  })

  it('draws realistic as a fan', () => {
    const strands = yarnStrands('realistic', FROM, TO)
    expect(strands.length).toBe(DEFAULT_FUZZ.strands)
    expect(new Set(strands.map((s) => s.d)).size).toBe(strands.length)
  })

  it('offers exactly the two styles the settings pane asks for', () => {
    expect([...YARN_STYLES]).toEqual(['minimal', 'realistic'])
    for (const style of YARN_STYLES) {
      expect(yarnStrands(style, FROM, TO).length).toBeGreaterThan(0)
    }
  })

  it('reads both styles at a comparable weight', () => {
    const minimal = yarnStrands('minimal', FROM, TO)[0]
    const realistic = yarnStrands('realistic', FROM, TO)
    const ink = realistic.reduce((total, s) => total + s.width * s.opacity, 0)
    // A fan of hairlines must not come out heavier than one solid stroke, or
    // the board goes muddy when the style is switched.
    expect(ink).toBeLessThan(minimal.width * 1.6)
    expect(ink).toBeGreaterThan(minimal.width * 0.8)
  })

  it('does not cache one style under the other', () => {
    clearYarnStyleCache()
    const minimal = yarnStrands('minimal', FROM, TO)
    const realistic = yarnStrands('realistic', FROM, TO)
    expect(realistic).not.toBe(minimal)
    expect(realistic.length).toBeGreaterThan(minimal.length)
  })
})
