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
  /** Filaments in the fan, centre included. */
  strands?: number
  /** Peak lateral wobble of a filament, in board px; absolute, not proportional. */
  amplitude?: number
  /** Peak distance from the curve to an outermost filament, in board px. */
  spread?: number
  /** Noise cycles along the string. */
  frequency?: number
  /** Gauge of the wool in board px; both styles are scaled from it. */
  width?: number
  /** Vertices per filament. */
  samples?: number
}

export const MAX_STRANDS = 12

export const DEFAULT_FUZZ: Required<FuzzOptions> = {
  strands: 5,
  amplitude: 1.3,
  spread: 2.4,
  frequency: 4,
  width: 1.2,
  samples: 16,
}

/** Scale for 'minimal' so a solid stroke reads as the same yarn as the fan. */
const MINIMAL_GAUGE = 1.8

const MIN_SAMPLES = 4
const MAX_SAMPLES = 64

/** Int32 avalanche (murmur3 finalizer); a cheap hash leaves visible banding. */
function hashLattice(cell: number, seed: number): number {
  let h = Math.imul(cell, 0x27d4eb2d) ^ Math.imul(seed, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Value noise in [-1, 1], Lipschitz-bounded (slope ≤ 3); seeds must be integers. */
export function valueNoise(x: number, seed: number): number {
  const cell = Math.floor(x)
  const within = x - cell
  const a = hashLattice(cell, seed)
  const b = hashLattice(cell + 1, seed)
  const fade = within * within * (3 - 2 * within)
  return (a + (b - a) * fade) * 2 - 1
}

/** Irrational-ish so the octaves do not share zero crossings. */
const OCTAVE_RATIO = 2.37
const OCTAVE_WEIGHT = 0.5

function fbm(x: number, seed: number): number {
  const coarse = valueNoise(x, seed)
  const fine = valueNoise(x * OCTAVE_RATIO, seed ^ 0x5bf03635)
  return (coarse + OCTAVE_WEIGHT * fine) / (1 + OCTAVE_WEIGHT)
}

/** Stable seed for a key, so geometry does not reshuffle between reloads. */
export function seedFromKey(key: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}

interface ResolvedFuzz {
  strands: number
  amplitude: number
  spread: number
  frequency: number
  width: number
  samples: number
  key: string
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}

/** NaN/Infinity from a UI control must fall back, or it writes "NaN" into path data. */
function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback
}

function resolve(options?: FuzzOptions): ResolvedFuzz {
  if (options === undefined) return DEFAULT_RESOLVED

  const strands = clamp(Math.round(finite(options.strands, DEFAULT_FUZZ.strands)), 1, MAX_STRANDS)
  const amplitude = Math.max(0, finite(options.amplitude, DEFAULT_FUZZ.amplitude))
  const spread = Math.max(0, finite(options.spread, DEFAULT_FUZZ.spread))
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

/** Each filament must offset a different lattice index or they wobble in unison. */
function strandSeedFor(seed: number, index: number): number {
  return (seed + Math.imul(index + 1, 0x9e3779b1)) | 0
}

// -0.5 at one edge, +0.5 at the other, so the fan is symmetric and the fuzz zero-mean.
function positionInFan(index: number, count: number): number {
  return count <= 1 ? 0 : index / (count - 1) - 0.5
}

function offsetAt(t: number, index: number, count: number, seed: number, opts: ResolvedFuzz): number {
  // Exact zero at the ends so the first and last vertex land on the pin.
  if (t <= 0 || t >= 1) return 0
  const bias = positionInFan(index, count) * opts.spread
  const wobble = opts.amplitude * fbm(t * opts.frequency, strandSeedFor(seed, index))
  return Math.sin(Math.PI * t) * (bias + wobble)
}

/** Signed lateral offset along the curve's (-ty, tx) normal, in board px; zero at both ends. */
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

/** Upper bound on a filament's distance from the curve, in board px. */
export function maxStrandDeviation(options?: FuzzOptions): number {
  const opts = resolve(options)
  return opts.spread / 2 + opts.amplitude
}

/** Catmull-Rom, so the curve passes through every sample and starts and ends exactly on the pins. */
function smoothPath(xs: readonly number[], ys: readonly number[], tension = 1): string {
  const count = xs.length
  if (count === 0) return ''
  if (count === 1) return `M ${round2(xs[0])} ${round2(ys[0])}`
  if (count === 2) {
    return `M ${round2(xs[0])} ${round2(ys[0])} L ${round2(xs[1])} ${round2(ys[1])}`
  }

  // /6 is the standard Catmull-Rom-to-Bezier constant.
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

  const baseX = new Array<number>(samples)
  const baseY = new Array<number>(samples)
  const normalX = new Array<number>(samples)
  const normalY = new Array<number>(samples)

  for (let i = 0; i < samples; i++) {
    const t = i / steps
    const base = pointOnYarn(from, to, t, slack)
    const inverse = 1 - t
    // Offset along the analytic tangent's normal; pushing along x would shear steep strings.
    const tx = 2 * (inverse * (control.x - from.x) + t * (to.x - control.x))
    const ty = 2 * (inverse * (control.y - from.y) + t * (to.y - control.y))
    const length = Math.hypot(tx, ty)
    // Zero-length string collapses the fuzz to a point rather than an arbitrary direction.
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
      // Centre filament thickest and most opaque; outer ones are hairlines.
      d: smoothPath(xs, ys),
      width: opts.width * (0.55 + 0.45 * centrality),
      opacity: 0.35 + 0.55 * centrality,
    })
  }

  return strands
}

/** Returned array is shared with the cache — treat it as immutable. */
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

const CACHE_LIMIT = 2048

const cache = new Map<string, readonly YarnStrand[]>()

function remember(key: string, value: readonly YarnStrand[]): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

export function clearYarnStyleCache(): void {
  cache.clear()
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function pointKey(point: Point): string {
  return `${round2(point.x)},${round2(point.y)}`
}
