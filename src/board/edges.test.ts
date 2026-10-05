import { describe, expect, it } from 'vitest'

import {
  EDGE_CACHE_LIMIT,
  EDGE_PRESETS,
  EDGE_STYLES,
  MAX_DEPTH_RATIO,
  MAX_SAMPLES_PER_SIDE,
  MIN_SAMPLES_PER_SIDE,
  clearEdgeCache,
  edgeCacheSize,
  edgeClipPath,
  seedFromKey,
} from './edges'
import type { EdgeOptions, EdgeStyle } from './edges'

const WIDTH = 320
const HEIGHT = 240
const BOX_AREA = WIDTH * HEIGHT

/** Boxes with different aspect ratios: a square, a landscape photo, a strip. */
const BOXES = [
  { w: 320, h: 240 },
  { w: 180, h: 180 },
  { w: 640, h: 90 },
]

const SEEDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

interface Vertex {
  x: number
  y: number
}

/**
 * Pull the vertices back out of the emitted clip-path.
 *
 * Every geometric invariant below is checked on these numbers rather than on
 * the string, which is what makes "the crop never leaves the box" a statement
 * about the shape and not about its spelling.
 */
function vertices(clip: string): Vertex[] {
  const body = clip.slice('polygon('.length, -1)
  return body.split(',').map((pair) => {
    const [x, y] = pair.trim().split(/\s+/)
    return { x: Number.parseFloat(x), y: Number.parseFloat(y) }
  })
}

/**
 * Shoelace area, signed. The walk is clockwise on screen, so a healthy shape
 * has a positive area: a negative one means the outline inverted and the pin
 * would be showing its own background through itself.
 */
function signedArea(points: readonly Vertex[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

function cross(a: Vertex, b: Vertex, c: Vertex): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function onSegment(a: Vertex, b: Vertex, p: Vertex): boolean {
  return (
    Math.min(a.x, b.x) - 1e-9 <= p.x &&
    p.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.y, b.y) - 1e-9 <= p.y &&
    p.y <= Math.max(a.y, b.y) + 1e-9
  )
}

/** Overlap of two collinear segments along the first one's direction, 0..1. */
function projectionOverlap(a: Vertex, b: Vertex, c: Vertex, d: Vertex): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-12) return 0
  const at = (p: Vertex) => ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared
  const c0 = at(c)
  const c1 = at(d)
  return Math.min(1, Math.max(c0, c1)) - Math.max(0, Math.min(c0, c1))
}

/**
 * Whether two segments cross or overlap.
 *
 * A shared endpoint is not a crossing — the walk's own corners do that by
 * construction — so the collinear branches only fire on a real overlap, which
 * is the signature of an outline that has folded back through itself.
 */
function segmentsCross(a: Vertex, b: Vertex, c: Vertex, d: Vertex): boolean {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)

  if (d1 * d2 < 0 && d3 * d4 < 0) return true
  if (d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0) return projectionOverlap(a, b, c, d) > 1e-9
  if (d1 === 0 && onSegment(c, d, a)) return true
  if (d2 === 0 && onSegment(c, d, b)) return true
  if (d3 === 0 && onSegment(a, b, c)) return true
  if (d4 === 0 && onSegment(a, b, d)) return true
  return false
}

function selfIntersections(points: readonly Vertex[]): number {
  const n = points.length
  let crossings = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      // Neighbours always share a vertex, and the walk closes on itself.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (segmentsCross(a, b, points[j], points[(j + 1) % n])) crossings++
    }
  }
  return crossings
}

/** The plain rectangle a box of this size should clip to. */
function expectedBox(w: number, h: number): string {
  return `polygon(0px 0px, ${w}px 0px, ${w}px ${h}px, 0px ${h}px)`
}

/**
 * Every geometric invariant a crop must hold, in one place.
 *
 * A crop is only allowed to remove material from the inside of the box: it may
 * not push a vertex outside the box (the element would tear a hole in the
 * layout it is painted into), may not invert (the shape would render as its own
 * complement), and may not eat so much that the pin is unreadable.
 */
function assertSaneCrop(
  style: EdgeStyle,
  w: number,
  h: number,
  seed: number,
  options?: EdgeOptions,
): void {
  const clip = edgeClipPath(style, w, h, seed, options)
  expect(clip.startsWith('polygon(')).toBe(true)
  expect(clip.endsWith(')')).toBe(true)

  const points = vertices(clip)
  expect(points.length).toBeGreaterThanOrEqual(4)

  for (const point of points) {
    expect(Number.isFinite(point.x)).toBe(true)
    expect(Number.isFinite(point.y)).toBe(true)
    // The 0.005 is the 2dp rounding quantum, not slack in the geometry.
    expect(point.x).toBeGreaterThanOrEqual(-0.005)
    expect(point.x).toBeLessThanOrEqual(w + 0.005)
    expect(point.y).toBeGreaterThanOrEqual(-0.005)
    expect(point.y).toBeLessThanOrEqual(h + 0.005)
  }

  const area = signedArea(points)
  expect(area).toBeGreaterThan(0)
  // A fifth of the box may be nibbled away at the extreme; below 70% it stops
  // being a cropped pin and starts being a damaged one.
  expect(area).toBeGreaterThanOrEqual(0.7 * w * h)
  expect(area).toBeLessThanOrEqual(w * h * 1.0001)

  expect(selfIntersections(points)).toBe(0)
}

describe('EDGE_STYLES', () => {
  it('offers the four named forms plus invented ones, every one of them drawable', () => {
    for (const required of ['clean', 'burnt', 'stamped', 'torn']) {
      expect(EDGE_STYLES).toContain(required)
    }
    // Three invented styles is the floor; each has to be a different kind of
    // damage rather than a louder noise, which the distinctness test below is
    // the closest a test can come to checking.
    expect(EDGE_STYLES.length).toBeGreaterThanOrEqual(7)
    for (const style of EDGE_STYLES) {
      const clip = edgeClipPath(style, WIDTH, HEIGHT, 1)
      expect(clip).toMatch(/^polygon\(.*\)$/)
      expect(vertices(clip).length).toBeGreaterThanOrEqual(4)
    }
  })

  it('gives every style a different path for one seed', () => {
    // If two styles ever coincide they are the same style with two names, and a
    // settings pane offering them is lying to the user.
    for (const seed of [1, 12, 999]) {
      const paths = EDGE_STYLES.map((style) => edgeClipPath(style, WIDTH, HEIGHT, seed))
      expect(new Set(paths).size).toBe(EDGE_STYLES.length)
    }
  })

  it('has a preset for every style, with the depth inside the documented ceiling', () => {
    for (const style of EDGE_STYLES) {
      const preset = EDGE_PRESETS[style]
      expect(preset).toBeDefined()
      expect(preset.depth).toBeGreaterThanOrEqual(0)
      expect(preset.depth).toBeLessThanOrEqual(MAX_DEPTH_RATIO)
      expect(preset.samples).toBeGreaterThanOrEqual(MIN_SAMPLES_PER_SIDE)
      expect(preset.samples).toBeLessThanOrEqual(MAX_SAMPLES_PER_SIDE)
    }
  })

  it('falls back to clean for an unknown style instead of throwing', () => {
    // A persisted setting written by a newer build must not blank the board.
    const unknown = 'carved' as EdgeStyle
    expect(edgeClipPath(unknown, WIDTH, HEIGHT, 4)).toBe(expectedBox(WIDTH, HEIGHT))
  })
})

describe('clean', () => {
  it('returns the plain full-box rectangle, byte-stable at every seed', () => {
    // Clean is the "no crop" member: it exists so the settings pane can offer
    // an off position without every caller special-casing undefined.
    expect(edgeClipPath('clean', WIDTH, HEIGHT, 1)).toBe(expectedBox(WIDTH, HEIGHT))
    expect(edgeClipPath('clean', WIDTH, HEIGHT, 999)).toBe(expectedBox(WIDTH, HEIGHT))
    expect(edgeClipPath('clean', WIDTH, HEIGHT, 1)).toBe(expectedBox(WIDTH, HEIGHT))

    const points = vertices(edgeClipPath('clean', WIDTH, HEIGHT, 1))
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: WIDTH, y: 0 },
      { x: WIDTH, y: HEIGHT },
      { x: 0, y: HEIGHT },
    ])
    expect(signedArea(points)).toBe(BOX_AREA)
  })

  it('cannot be damaged by options or by a cleared cache', () => {
    clearEdgeCache()
    expect(edgeClipPath('clean', WIDTH, HEIGHT, 3, { depth: MAX_DEPTH_RATIO, jitter: 1 })).toBe(
      expectedBox(WIDTH, HEIGHT),
    )
  })

  it('is the identity for a zero depth in every other style too', () => {
    // Depth zero means "no bites", whatever shape the profile would have drawn.
    for (const style of EDGE_STYLES) {
      expect(edgeClipPath(style, WIDTH, HEIGHT, 8, { depth: 0 })).toBe(expectedBox(WIDTH, HEIGHT))
    }
  })
})

describe('determinism', () => {
  it('returns byte-identical paths for the same arguments', () => {
    for (const style of EDGE_STYLES) {
      expect(edgeClipPath(style, WIDTH, HEIGHT, 42)).toBe(edgeClipPath(style, WIDTH, HEIGHT, 42))
    }
  })

  it('recomputes the identical path after the cache is cleared', () => {
    // Without this the determinism could be the memo table rather than the
    // maths — a generator seeded from a counter or from Math.random() would
    // still pass the test above.
    for (const style of EDGE_STYLES) {
      const first = edgeClipPath(style, WIDTH, HEIGHT, 42, { jitter: 0.6 })
      clearEdgeCache()
      expect(edgeClipPath(style, WIDTH, HEIGHT, 42, { jitter: 0.6 })).toBe(first)
    }
  })

  it('re-cracks the edge for every seed, so two pins of one style never match', () => {
    for (const style of EDGE_STYLES) {
      if (style === 'clean') continue // clean is seed-invariant by definition
      const paths = new Set(SEEDS.map((seed) => edgeClipPath(style, WIDTH, HEIGHT, seed)))
      expect(paths.size).toBeGreaterThan(1)
      // Not merely two: the seed has to reach every part of the profile, or
      // most of the board's edges drift back into being copies of each other.
      expect(paths.size).toBeGreaterThanOrEqual(SEEDS.length * 0.75)
    }
  })

  it('seeds an edge from a pin id, so identical notes still differ', () => {
    // The intended wiring: same id, same edge forever; different ids, different
    // damage. seedFromKey is re-exported so callers do not need a second scheme.
    const first = edgeClipPath('torn', WIDTH, HEIGHT, seedFromKey('pin:a'))
    const second = edgeClipPath('torn', WIDTH, HEIGHT, seedFromKey('pin:b'))
    expect(first).not.toBe(second)
    expect(edgeClipPath('torn', WIDTH, HEIGHT, seedFromKey('pin:a'))).toBe(first)
  })

  it('responds to every option it documents', () => {
    // A resolve bug that dropped a field would otherwise be invisible: the
    // paths would just quietly stop varying.
    const base = edgeClipPath('burnt', WIDTH, HEIGHT, 3)
    expect(edgeClipPath('burnt', WIDTH, HEIGHT, 3, { depth: MAX_DEPTH_RATIO })).not.toBe(base)
    expect(edgeClipPath('burnt', WIDTH, HEIGHT, 3, { frequency: 12 })).not.toBe(base)
    expect(edgeClipPath('burnt', WIDTH, HEIGHT, 3, { samples: MAX_SAMPLES_PER_SIDE })).not.toBe(base)

    const stamped = edgeClipPath('stamped', WIDTH, HEIGHT, 3)
    expect(edgeClipPath('stamped', WIDTH, HEIGHT, 3, { density: 12 })).not.toBe(stamped)

    const scorched = edgeClipPath('scorched', WIDTH, HEIGHT, 3)
    expect(edgeClipPath('scorched', WIDTH, HEIGHT, 3, { spread: 1 })).not.toBe(scorched)
  })

  it('lets jitter reach every style, so the knob is never dead in the settings pane', () => {
    for (const style of EDGE_STYLES) {
      if (style === 'clean') continue
      const regular = edgeClipPath(style, WIDTH, HEIGHT, 5, { jitter: 0 })
      const irregular = edgeClipPath(style, WIDTH, HEIGHT, 5, { jitter: 1 })
      expect(regular).not.toBe(irregular)
    }
  })
})

describe('bounds', () => {
  it('keeps every vertex inside the box, at default options and at absurd ones', () => {
    const absurd: EdgeOptions = {
      depth: 999,
      frequency: 999,
      jitter: 999,
      samples: MAX_SAMPLES_PER_SIDE,
      density: 999,
      spread: 999,
    }
    for (const { w, h } of BOXES) {
      for (const style of EDGE_STYLES) {
        for (const seed of [1, 5]) {
          assertSaneCrop(style, w, h, seed)
          assertSaneCrop(style, w, h, seed, absurd)
        }
      }
    }
  })

  it('never lets a crop eat more than a third of its box', () => {
    // The ceiling on depth exists so this can be asserted rather than hoped
    // for: four sides at the maximum still leave 74% of a square standing.
    const worstCase: EdgeOptions = { depth: MAX_DEPTH_RATIO, jitter: 1 }
    for (const style of EDGE_STYLES) {
      const points = vertices(edgeClipPath(style, 240, 240, 6, worstCase))
      expect(signedArea(points)).toBeGreaterThanOrEqual(0.7 * 240 * 240)
    }
  })

  it('never folds the outline onto itself', () => {
    // A self-intersection would clip the pin into wedges, and its shoelace area
    // would no longer be the area the user sees — the invariant the whole
    // module is built around.
    for (const style of EDGE_STYLES) {
      for (const seed of [0, 3]) {
        const points = vertices(edgeClipPath(style, WIDTH, HEIGHT, seed, { jitter: 1 }))
        expect(selfIntersections(points)).toBe(0)
      }
    }
  })

  it('tracks the box it was given, so a resized pin does not crop the old shape', () => {
    // The shape has to reach nearly to every side of the box it was handed. It
    // may stop short by at most the deepest bite plus the corner inset — an
    // edge that is entirely burnt genuinely pulls its whole side in that far.
    const w = 500
    const h = 300
    const reach = 1.05 * MAX_DEPTH_RATIO * Math.min(w, h)
    for (const style of EDGE_STYLES) {
      const points = vertices(edgeClipPath(style, w, h, 2))
      expect(Math.max(...points.map((p) => p.x))).toBeGreaterThanOrEqual(w - reach)
      expect(Math.max(...points.map((p) => p.y))).toBeGreaterThanOrEqual(h - reach)
      expect(Math.min(...points.map((p) => p.x))).toBeLessThanOrEqual(reach)
      expect(Math.min(...points.map((p) => p.y))).toBeLessThanOrEqual(reach)
    }
  })
})

describe('robustness', () => {
  it('survives non-finite, negative and zero sizes without emitting NaN', () => {
    // A pin measured as 0x0 on its first frame, or a width read from an
    // unparsed string, must not throw and must not write a clip path the
    // browser refuses to parse — either would blank the pin.
    const sizes = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -40, 0, 0.001]
    for (const style of EDGE_STYLES) {
      for (const w of sizes) {
        for (const h of sizes) {
          const clip = edgeClipPath(style, w, h, 3)
          expect(clip).toMatch(/^polygon\(/)
          expect(clip).toMatch(/\)$/)
          expect(clip).not.toMatch(/NaN|Infinity/)
          const points = vertices(clip)
          expect(points.length).toBeGreaterThanOrEqual(3)
          for (const point of points) {
            expect(Number.isFinite(point.x)).toBe(true)
            expect(Number.isFinite(point.y)).toBe(true)
          }
        }
      }
    }
  })

  it('treats a non-finite option exactly as if it were absent', () => {
    // An emptied number box yields NaN. Clamping alone passes NaN through, which
    // is how "NaN" ends up inside a clip path.
    const broken: EdgeOptions = {
      depth: Number.NaN,
      frequency: Number.NaN,
      jitter: Number.NaN,
      samples: Number.NaN,
      density: Number.NaN,
      spread: Number.NaN,
    }
    for (const style of EDGE_STYLES) {
      expect(edgeClipPath(style, WIDTH, HEIGHT, 4, broken)).toBe(edgeClipPath(style, WIDTH, HEIGHT, 4))
      expect(edgeClipPath(style, WIDTH, HEIGHT, 4, { depth: Number.POSITIVE_INFINITY })).toBe(
        edgeClipPath(style, WIDTH, HEIGHT, 4),
      )
    }
  })

  it('clamps options that would otherwise fold or erase the shape', () => {
    expect(edgeClipPath('torn', WIDTH, HEIGHT, 1, { depth: 999 })).toBe(
      edgeClipPath('torn', WIDTH, HEIGHT, 1, { depth: MAX_DEPTH_RATIO }),
    )
    expect(edgeClipPath('frayed', WIDTH, HEIGHT, 1, { samples: 1e9 })).toBe(
      edgeClipPath('frayed', WIDTH, HEIGHT, 1, { samples: MAX_SAMPLES_PER_SIDE }),
    )
    expect(edgeClipPath('frayed', WIDTH, HEIGHT, 1, { samples: -5 })).toBe(
      edgeClipPath('frayed', WIDTH, HEIGHT, 1, { samples: MIN_SAMPLES_PER_SIDE }),
    )
    expect(edgeClipPath('stamped', WIDTH, HEIGHT, 1, { jitter: 99 })).toBe(
      edgeClipPath('stamped', WIDTH, HEIGHT, 1, { jitter: 1 }),
    )
    expect(edgeClipPath('torn', WIDTH, HEIGHT, 1, { depth: -1 })).toBe(
      edgeClipPath('torn', WIDTH, HEIGHT, 1, { depth: 0 }),
    )
  })

  it('folds a non-finite seed to a real one instead of poisoning the hash', () => {
    expect(edgeClipPath('burnt', WIDTH, HEIGHT, Number.NaN)).toBe(edgeClipPath('burnt', WIDTH, HEIGHT, 0))
    expect(edgeClipPath('burnt', WIDTH, HEIGHT, Number.POSITIVE_INFINITY)).toBe(
      edgeClipPath('burnt', WIDTH, HEIGHT, 0),
    )
  })
})

describe('the cache', () => {
  it('serves a repeat call from the cache instead of rebuilding it', () => {
    clearEdgeCache()
    const first = edgeClipPath('burnt', WIDTH, HEIGHT, 5)
    expect(edgeCacheSize()).toBe(1)
    expect(edgeClipPath('burnt', WIDTH, HEIGHT, 5)).toBe(first)
    expect(edgeCacheSize()).toBe(1)

    // A new seed, a new size and a changed option must each miss.
    edgeClipPath('burnt', WIDTH, HEIGHT, 6)
    edgeClipPath('burnt', WIDTH, HEIGHT + 1, 5)
    edgeClipPath('burnt', WIDTH, HEIGHT, 5, { jitter: 0.5, depth: 0.04 })
    expect(edgeCacheSize()).toBe(4)
  })

  it('is bounded, so memory cannot creep as pins are moved and resized', () => {
    clearEdgeCache()
    for (let i = 0; i < EDGE_CACHE_LIMIT + 25; i++) edgeClipPath('deckled', 40, 30, i)
    expect(edgeCacheSize()).toBeLessThanOrEqual(EDGE_CACHE_LIMIT)

    // Eviction is oldest-first, so the most recent edges are the ones kept.
    const newest = edgeClipPath('deckled', 40, 30, EDGE_CACHE_LIMIT + 24)
    clearEdgeCache()
    expect(edgeClipPath('deckled', 40, 30, EDGE_CACHE_LIMIT + 24)).toBe(newest)
  })
})
