/**
 * Yarn styles.
 *
 * 'minimal' is the clean single stroke from ./yarn. 'realistic' is wool: a fan
 * of fine strands pushed off the base curve by a noise field.
 *
 * The fuzz is GEOMETRY, never an SVG filter. feTurbulence/feDisplacementMap
 * force the browser to re-rasterize the whole subtree on every frame, which a
 * board of several hundred strings cannot pay for; these strands are baked into
 * path data once per geometry change and then cost nothing to pan or zoom.
 *
 * Every strand samples its own field, so fibres CROSS. A synchronous offset —
 * the obvious first implementation — reads as concentric outlines, i.e. as one
 * thicker smooth string, which is worse than no fuzz at all.
 *
 * COST: one build is O(strands x samples). At the defaults that is 5 x 16 = 80
 * offset samples and 80 vertices, measured at ~40us per string — so a full
 * 300-string board rebuilds in about 12ms, and only when geometry actually
 * moves. Results are cached on (style, endpoints, slack, seed, options), so
 * re-renders and camera moves are a Map lookup per string (~1.5us) and a drag
 * misses for exactly the one string being dragged. The cache is bounded so
 * memory cannot creep as pins are moved around.
 *
 * Everything here is pure and seedable: identical input yields byte-identical
 * path data, which is what makes the cache sound and the output testable.
 */

import { DEFAULT_SLACK, controlPoint, pointOnYarn, yarnPath } from './yarn'
import type { Point } from './yarn'

export const YARN_STYLES = ['minimal', 'realistic'] as const
export type YarnStyle = (typeof YARN_STYLES)[number]

/** One filament. Path data only — the caller owns colour and compositing. */
export interface YarnStrand {
  /** SVG path data in board space. */
  readonly d: string
  /** Stroke width in board px. */
  readonly width: number
  readonly opacity: number
}

export interface FuzzOptions {
  /** Filaments in the fan, centre included. Clamped to [1, MAX_STRANDS]. */
  strands?: number
  /** Peak lateral wobble of a filament, board px. Absolute, not proportional. */
  amplitude?: number
  /** Peak distance from the curve to an outermost filament, board px. */
  spread?: number
  /** Noise cycles along the string. Higher reads as shorter, kinkier wool. */
  frequency?: number
  /** Gauge of the wool in board px; both styles are scaled from it. */
  width?: number
  /** Vertices per filament. More is smoother and dearer. */
  samples?: number
}

/** Each extra filament is another path per string per frame; twelve is plenty. */
export const MAX_STRANDS = 12

export const DEFAULT_FUZZ: Required<FuzzOptions> = {
  strands: 5,
  amplitude: 1.3,
  spread: 2.4,
  frequency: 4,
  width: 1.2,
  samples: 16,
}

/**
 * A solid stroke carries more ink than a fan of hairlines, so 'minimal' is
 * drawn at this multiple of the gauge for the two styles to read as the same
 * yarn at a glance.
 */
const MINIMAL_GAUGE = 1.8

const MIN_SAMPLES = 4
const MAX_SAMPLES = 64

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

/**
 * Lattice hash: an int32 avalanche (murmur3's finalizer). Neighbouring cells
 * must decorrelate completely — a cheap `sin(x * k)` hash leaves visible
 * diagonal banding, and banding in the fuzz reads as a rendering artefact
 * rather than as wool.
 */
function hashLattice(cell: number, seed: number): number {
  let h = Math.imul(cell, 0x27d4eb2d) ^ Math.imul(seed, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/**
 * One-dimensional value noise in [-1, 1], zero-mean and Lipschitz-continuous
 * (slope bounded by 3: smoothstep peaks at 1.5, doubled by the ±1 remap),
 * which is what lets the tests prove the fuzz can neither spike nor drift.
 * Seeds are folded to int32, so use integers.
 */
export function valueNoise(x: number, seed: number): number {
  const cell = Math.floor(x)
  const within = x - cell
  const a = hashLattice(cell, seed)
  const b = hashLattice(cell + 1, seed)
  const fade = within * within * (3 - 2 * within)
  return (a + (b - a) * fade) * 2 - 1
}

/** Irrational-ish so the octaves do not share zero crossings and beat. */
const OCTAVE_RATIO = 2.37
const OCTAVE_WEIGHT = 0.5

/** Two octaves: the coarse wave gives the drape, the fine one gives the fuzz. */
function fbm(x: number, seed: number): number {
  const coarse = valueNoise(x, seed)
  const fine = valueNoise(x * OCTAVE_RATIO, seed ^ 0x5bf03635)
  return (coarse + OCTAVE_WEIGHT * fine) / (1 + OCTAVE_WEIGHT)
}

/**
 * A stable seed for a connection, so wool does not re-shuffle itself between
 * reloads. Callers should feed this the same key they use for the string's
 * identity.
 */
export function seedFromKey(key: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}

// ---------------------------------------------------------------------------
// The offset field
// ---------------------------------------------------------------------------

interface ResolvedFuzz {
  strands: number
  amplitude: number
  spread: number
  frequency: number
  width: number
  samples: number
  /** Stable identity of the resolved numbers, for the geometry cache. */
  key: string
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}

/**
 * A numeric option fed from a UI control can be NaN (an emptied number box) or
 * Infinity. Clamping passes NaN straight through, which silently costs a fan
 * its strands (`Math.round(NaN)` never satisfies `s < count`) or writes "NaN"
 * into path data the browser then refuses to draw — so fall back instead.
 */
function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback
}

function resolve(options?: FuzzOptions): ResolvedFuzz {
  // Cached-path calls land here once per string per frame, so the default case
  // must not allocate: the board cache-hits 300 times for every string that
  // moves.
  if (options === undefined) return DEFAULT_RESOLVED

  const strands = clamp(Math.round(finite(options.strands, DEFAULT_FUZZ.strands)), 1, MAX_STRANDS)
  const amplitude = Math.max(0, finite(options.amplitude, DEFAULT_FUZZ.amplitude))
  const spread = Math.max(0, finite(options.spread, DEFAULT_FUZZ.spread))
  // Below one cycle the whole string bends as a unit, which reads as a sag
  // change rather than as fibre.
  const frequency = Math.max(1, finite(options.frequency, DEFAULT_FUZZ.frequency))
  const width = Math.max(0.05, finite(options.width, DEFAULT_FUZZ.width))
  const samples = clamp(Math.round(finite(options.samples, DEFAULT_FUZZ.samples)), MIN_SAMPLES, MAX_SAMPLES)
  return {
    strands,
    amplitude,
    spread,
    frequency,
    width,
    samples,
    key: `${strands}|${amplitude}|${spread}|${frequency}|${width}|${samples}`,
  }
}

const DEFAULT_RESOLVED: ResolvedFuzz = {
  ...DEFAULT_FUZZ,
  key: `${DEFAULT_FUZZ.strands}|${DEFAULT_FUZZ.amplitude}|${DEFAULT_FUZZ.spread}|${DEFAULT_FUZZ.frequency}|${DEFAULT_FUZZ.width}|${DEFAULT_FUZZ.samples}`,
}

/** Offsetting the same lattice index would make all filaments wobble in unison. */
function strandSeedFor(seed: number, index: number): number {
  return (seed + Math.imul(index + 1, 0x9e3779b1)) | 0
}

function positionInFan(index: number, count: number): number {
  // -0.5 at one edge, +0.5 at the other, so the fan is symmetric about the
  // curve and the fuzz is zero-mean by construction.
  return count <= 1 ? 0 : index / (count - 1) - 0.5
}

/** The workhorse: no allocation, no clamping, options already resolved. */
function offsetAt(t: number, index: number, count: number, seed: number, opts: ResolvedFuzz): number {
  // Pinned at both tacks: the sin envelope already vanishes there, but an exact
  // zero means the path's first and last vertex land on the pin, not a
  // floating-point hair off it.
  if (t <= 0 || t >= 1) return 0
  const bias = positionInFan(index, count) * opts.spread
  const wobble = opts.amplitude * fbm(t * opts.frequency, strandSeedFor(seed, index))
  return Math.sin(Math.PI * t) * (bias + wobble)
}

/**
 * Signed lateral displacement of one filament at parameter `t`, in board px,
 * positive along the curve's (-ty, tx) normal — to the right of travel on
 * screen, where y points down. The envelope tapers to zero at both ends, so a
 * strand meets its tacks exactly however loose the string is.
 */
export function strandOffset(
  t: number,
  strandIndex: number,
  strandCount: number,
  seed: number,
  options?: FuzzOptions,
): number {
  const count = clamp(Math.round(finite(strandCount, 1)), 1, MAX_STRANDS)
  const index = clamp(Math.round(finite(strandIndex, 0)), 0, count - 1)
  return offsetAt(t, index, count, seed | 0, resolve(options))
}

/**
 * The furthest any filament can sit from the base curve, in board px.
 *
 * The fuzz is bounded by construction — the envelope never exceeds 1, the noise
 * never exceeds 1, the fan is symmetric — so hit-testing and label placement
 * can trust this rather than measuring.
 */
export function maxStrandDeviation(options?: FuzzOptions): number {
  const opts = resolve(options)
  return opts.spread / 2 + opts.amplitude
}

// ---------------------------------------------------------------------------
// Strands
// ---------------------------------------------------------------------------

/**
 * A smooth path through the sampled points.
 *
 * Joining samples with straight `L` segments leaves visible corners at the
 * sample rate we use — 16 points over a 600px string is a 40px joint, and a
 * filament is supposed to read as fibre rather than as a chain of sticks. Hard
 * corners are also what makes fuzz look like geometry instead of wool.
 *
 * This is uniform Catmull-Rom converted to cubic beziers. Catmull-Rom rather
 * than a B-spline because it passes exactly *through* every sample: a B-spline
 * approximates its control points, which would round off the endpoints and pull
 * the string visibly short of its tacks.
 *
 * The phantom points at each end are clamped to the first and last samples, so
 * the curve starts and ends exactly on them and cannot overshoot the pin.
 */
function smoothPath(xs: readonly number[], ys: readonly number[], tension = 1): string {
  const count = xs.length
  if (count === 0) return ''
  if (count === 1) return `M ${round2(xs[0])} ${round2(ys[0])}`
  if (count === 2) {
    return `M ${round2(xs[0])} ${round2(ys[0])} L ${round2(xs[1])} ${round2(ys[1])}`
  }

  // The /6 is the standard Catmull-Rom-to-Bezier constant; the tension scales
  // it, so a caller can round the strands off more or less.
  const k = tension / 6
  let d = `M ${round2(xs[0])} ${round2(ys[0])}`

  for (let i = 0; i < count - 1; i++) {
    const x0 = xs[i > 0 ? i - 1 : 0]
    const y0 = ys[i > 0 ? i - 1 : 0]
    const x1 = xs[i]
    const y1 = ys[i]
    const x2 = xs[i + 1]
    const y2 = ys[i + 1]
    const x3 = xs[i + 2 < count ? i + 2 : count - 1]
    const y3 = ys[i + 2 < count ? i + 2 : count - 1]

    const c1x = x1 + (x2 - x0) * k
    const c1y = y1 + (y2 - y0) * k
    const c2x = x2 - (x3 - x1) * k
    const c2y = y2 - (y3 - y1) * k

    d += ` C ${round2(c1x)} ${round2(c1y)}, ${round2(c2x)} ${round2(c2y)}, ${round2(x2)} ${round2(y2)}`
  }

  return d
}

function buildStrands(
  from: Point,
  to: Point,
  slack: number,
  seed: number,
  opts: ResolvedFuzz,
): readonly YarnStrand[] {
  const samples = opts.samples
  const steps = samples - 1
  const control = controlPoint(from, to, slack)

  // Every filament rides the same base curve, so it is sampled once per string
  // rather than once per filament — that is the difference between 16 and 80
  // pointOnYarn calls per string.
  const baseX = new Array<number>(samples)
  const baseY = new Array<number>(samples)
  const normalX = new Array<number>(samples)
  const normalY = new Array<number>(samples)

  for (let i = 0; i < samples; i++) {
    const t = i / steps
    const base = pointOnYarn(from, to, t, slack)
    const inverse = 1 - t
    // Analytic tangent of the quadratic, so the offset can be applied along the
    // normal: pushing along x instead would shear the fuzz on steep strings.
    const tx = 2 * (inverse * (control.x - from.x) + t * (to.x - control.x))
    const ty = 2 * (inverse * (control.y - from.y) + t * (to.y - control.y))
    const length = Math.hypot(tx, ty)
    // A zero-length string has no direction; a zero normal collapses the fuzz
    // to a point instead of spraying it somewhere arbitrary.
    const inverseLength = length > 1e-9 ? 1 / length : 0
    baseX[i] = base.x
    baseY[i] = base.y
    normalX[i] = -ty * inverseLength
    normalY[i] = tx * inverseLength
  }

  const strands: YarnStrand[] = []
  for (let s = 0; s < opts.strands; s++) {
    const centrality = 1 - Math.abs(positionInFan(s, opts.strands)) * 2

    const xs = new Array<number>(samples)
    const ys = new Array<number>(samples)
    for (let i = 0; i < samples; i++) {
      const offset = offsetAt(i / steps, s, opts.strands, seed, opts)
      xs[i] = baseX[i] + normalX[i] * offset
      ys[i] = baseY[i] + normalY[i] * offset
    }

    strands.push({
      // The centre filament is the thickest and most opaque; the outer ones are
      // hairlines, which is what the eye reads as wool rather than as a rope.
      d: smoothPath(xs, ys),
      width: opts.width * (0.55 + 0.45 * centrality),
      opacity: 0.35 + 0.55 * centrality,
    })
  }

  return strands
}

/**
 * The realistic fan. Deterministic: the same arguments give identical output on
 * every call, in every process.
 *
 * The returned array is shared with the cache — treat it as immutable.
 */
export function fuzzyStrands(
  from: Point,
  to: Point,
  slack: number = DEFAULT_SLACK,
  seed = 0,
  options?: FuzzOptions,
): readonly YarnStrand[] {
  const opts = resolve(options)
  const key = `realistic|${seed | 0}|${slack}|${pointKey(from)}|${pointKey(to)}|${opts.key}`
  const cached = cache.get(key)
  if (cached) return cached

  const strands = buildStrands(from, to, slack, seed | 0, opts)
  remember(key, strands)
  return strands
}

/**
 * The renderer's entry point: one clean stroke or a woolly fan.
 *
 * Both styles are geometry-only, so a caller can draw them with the same single
 * <path> loop and switch on the style at the settings level.
 */
export function yarnStrands(
  style: YarnStyle,
  from: Point,
  to: Point,
  slack: number = DEFAULT_SLACK,
  seed = 0,
  options?: FuzzOptions,
): readonly YarnStrand[] {
  if (style === 'realistic') return fuzzyStrands(from, to, slack, seed, options)

  const opts = resolve(options)
  const key = `minimal|${seed | 0}|${slack}|${pointKey(from)}|${pointKey(to)}|${opts.key}`
  const cached = cache.get(key)
  if (cached) return cached

  const strands: readonly YarnStrand[] = [
    { d: yarnPath(from, to, slack), width: opts.width * MINIMAL_GAUGE, opacity: 1 },
  ]
  remember(key, strands)
  return strands
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_LIMIT = 2048

const cache = new Map<string, readonly YarnStrand[]>()

function remember(key: string, value: readonly YarnStrand[]): void {
  // Insertion order is the eviction order: the strings that have not moved
  // recently are the ones worth dropping.
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

/** For tests, and for anything that needs to prove a rebuild is honest. */
export function clearYarnStyleCache(): void {
  cache.clear()
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function pointKey(point: Point): string {
  return `${round2(point.x)},${round2(point.y)}`
}
