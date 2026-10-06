import { seedFromKey, valueNoise } from './yarn-style'

/** Same hashing scheme as yarn, so a pin's edge and yarn derive from one id. */
export { seedFromKey }

export const EDGE_STYLES = [
  'clean',
  'stamped',
  'scalloped',
  'burnt',
  'torn',
  'deckled',
  'scorched',
  'frayed',
  'nibbled',
  'chipped',
] as const

export type EdgeStyle = (typeof EDGE_STYLES)[number]

/** Same set as EDGE_STYLES, grouped by the `jitter` dial; a test keeps the two in step. */
export const EDGE_FAMILIES = [
  {
    id: 'pattern',
    styles: ['clean', 'stamped', 'scalloped'],
  },
  {
    id: 'noise',
    styles: ['burnt', 'torn', 'deckled', 'scorched', 'frayed', 'nibbled', 'chipped'],
  },
] as const satisfies readonly { id: string; styles: readonly EdgeStyle[] }[]

export interface EdgeOptions {
  /** Peak inward bite, as a fraction of the box's short side. */
  depth?: number
  frequency?: number
  jitter?: number
  samples?: number
  /** Discrete features per 100px of edge. */
  density?: number
  /** Fraction of the perimeter scorched's burn reaches around. */
  spread?: number
}

export type EdgePreset = Required<EdgeOptions>

export const EDGE_PRESETS: Readonly<Record<EdgeStyle, EdgePreset>> = {
  // jitter 0 is what puts clean in the pattern family.
  clean: { depth: 0, frequency: 1, jitter: 0, samples: 6, density: 1, spread: 0.35 },
  burnt: { depth: 0.05, frequency: 5, jitter: 1, samples: 40, density: 6, spread: 0.35 },
  stamped: { depth: 0.055, frequency: 1, jitter: 0, samples: 48, density: 6, spread: 0.35 },
  torn: { depth: 0.05, frequency: 3, jitter: 0.9, samples: 44, density: 6, spread: 0.35 },
  deckled: { depth: 0.022, frequency: 2.5, jitter: 1, samples: 32, density: 6, spread: 0.35 },
  scalloped: { depth: 0.018, frequency: 1, jitter: 0, samples: 40, density: 5, spread: 0.35 },
  scorched: { depth: 0.07, frequency: 4, jitter: 1, samples: 40, density: 6, spread: 0.3 },
  frayed: { depth: 0.03, frequency: 1, jitter: 0.6, samples: 56, density: 8, spread: 0.35 },
  nibbled: { depth: 0.03, frequency: 1, jitter: 0.9, samples: 40, density: 3, spread: 0.35 },
  chipped: { depth: 0.06, frequency: 1, jitter: 0.9, samples: 36, density: 1.2, spread: 0.35 },
}

/** Cut or keep per style; this is what guarantees the outline cannot fold. */
const CORNER_TREATMENT: Readonly<Record<EdgeStyle, 'cut' | 'keep'>> = {
  clean: 'keep',
  burnt: 'cut',
  stamped: 'keep',
  torn: 'cut',
  deckled: 'keep',
  scalloped: 'keep',
  scorched: 'cut',
  frayed: 'keep',
  nibbled: 'cut',
  chipped: 'cut',
}

/** Hard ceiling on a bite, as a fraction of the short side, so opposite sides cannot meet. */
export const MAX_DEPTH_RATIO = 0.07

export const MIN_SAMPLES_PER_SIDE = 4
export const MAX_SAMPLES_PER_SIDE = 64

/** Bounded so the cache cannot creep; oldest evicted first. */
export const EDGE_CACHE_LIMIT = 2048

const MIN_FREQUENCY = 0.25
const MAX_FREQUENCY = 24
const MIN_DENSITY = 0.2
const MAX_DENSITY = 40

const MAX_FEATURES_PER_SIDE = 24

/** Vertices per placed feature; three is the floor at which a bite still reads as a bite. */
const SAMPLES_PER_FEATURE = 3

/** Must exceed 1 (the peak); 1.5 keeps the fade short. */
const CORNER_RAMP = 1.5

const OCTAVE_RATIO = 2.37
const OCTAVE_WEIGHT = 0.5

/** Two octaves of yarn-style's noise, rectified to [0, 1]. */
function rough(x: number, seed: number): number {
  const coarse = valueNoise(x, seed)
  const fine = valueNoise(x * OCTAVE_RATIO, seed ^ 0x5bf03635)
  return 0.5 + 0.5 * ((coarse + OCTAVE_WEIGHT * fine) / (1 + OCTAVE_WEIGHT))
}

function swell(x: number, seed: number): number {
  return 0.5 + 0.5 * valueNoise(x, seed)
}

/** Integer cell of valueNoise returns the raw lattice hash, so it doubles as an RNG. */
function white(index: number, seed: number): number {
  return (valueNoise(index, seed) + 1) / 2
}

/** Per-side seed; sharing one field would make opposite edges ripple in mirror image. */
function sideSeed(seed: number, side: number): number {
  return (seed + Math.imul(side + 1, 0x9e3779b1)) | 0
}

function regularise(value: number, jitter: number): number {
  return 0.5 + (value - 0.5) * jitter
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}

/** A NaN from an emptied number box must fall back, or it writes "NaN" into the clip path. */
function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Non-finite or negative sizes collapse to 0, so the caller gets the plain rectangle. */
function extent(value: number): number {
  return Number.isFinite(value) && value > 0 ? round2(value) : 0
}

function num(value: number): string {
  // -0 formats as "-0"; normalising keeps output byte-stable.
  return String(value === 0 ? 0 : value)
}

interface ResolvedEdge {
  depth: number
  frequency: number
  jitter: number
  samples: number
  density: number
  spread: number
  key: string
}

function resolveFrom(style: EdgeStyle, options?: EdgeOptions): ResolvedEdge {
  const preset = EDGE_PRESETS[style] ?? EDGE_PRESETS.clean
  const depth = clamp(finite(options?.depth, preset.depth), 0, MAX_DEPTH_RATIO)
  const frequency = clamp(finite(options?.frequency, preset.frequency), MIN_FREQUENCY, MAX_FREQUENCY)
  const jitter = clamp(finite(options?.jitter, preset.jitter), 0, 1)
  const samples = clamp(
    Math.round(finite(options?.samples, preset.samples)),
    MIN_SAMPLES_PER_SIDE,
    MAX_SAMPLES_PER_SIDE,
  )
  const density = clamp(finite(options?.density, preset.density), MIN_DENSITY, MAX_DENSITY)
  const spread = clamp(finite(options?.spread, preset.spread), 0.05, 1)
  return {
    depth,
    frequency,
    jitter,
    samples,
    density,
    spread,
    key: `${depth}|${frequency}|${jitter}|${samples}|${density}|${spread}`,
  }
}

function resolve(style: EdgeStyle, options?: EdgeOptions): ResolvedEdge {
  return options === undefined ? DEFAULT_RESOLVED[style] : resolveFrom(style, options)
}

const DEFAULT_RESOLVED: Readonly<Record<EdgeStyle, ResolvedEdge>> = (() => {
  const table = {} as Record<EdgeStyle, ResolvedEdge>
  for (const style of EDGE_STYLES) table[style] = resolveFrom(style)
  return table
})()

/** The cursor a side walk hands to a profile; one object per edge, fields rewritten per sample. */
interface EdgeSample {
  /** Position along this side, 0..1, in walk order. */
  t: number
  /** Position along this side in px, in walk order. */
  s: number
  /** Position around the whole perimeter, 0..1 — for damage that spans a corner. */
  u: number
  /** This side's length in px. */
  len: number
  /** 0 top, 1 right, 2 bottom, 3 left. */
  side: number
  /** This side's own seed. */
  seed: number
  /** The caller's seed, for choices that must be global, not per-side. */
  root: number
  /** The depth ceiling in px, already resolved and clamped. */
  peak: number
  opts: ResolvedEdge
}

/** Inward depth in px; the walk clamps it to [0, peak]. */
type ProfileFn = (at: EdgeSample) => number

/** Past one feature per SAMPLES_PER_FEATURE the polygon aliases into a zigzag. */
function featureCount(len: number, opts: ResolvedEdge): number {
  const spacing = 100 / opts.density
  const bySamples = Math.max(1, Math.floor(opts.samples / SAMPLES_PER_FEATURE))
  return clamp(Math.round(len / spacing), 1, Math.min(MAX_FEATURES_PER_SIDE, bySamples))
}

const PROFILES: Readonly<Record<EdgeStyle, ProfileFn>> = {
  /** Never reached: `edgeClipPath` short-circuits clean. */
  clean: () => 0,

  burnt: (at) => {
    const { t, seed, peak, opts } = at
    return peak * (0.35 + 0.65 * regularise(rough(t * opts.frequency, seed), opts.jitter))
  },

  stamped: (at) => {
    const { s, len, seed, peak, opts } = at
    const count = featureCount(len, opts)
    const cell = len / count
    // Capped below half a cell so bites can never merge into a continuous wave.
    const radius = Math.min(peak, cell * 0.38)
    const phase = (white(0, seed) - 0.5) * cell * 0.5
    let depth = 0
    for (let i = 0; i < count; i++) {
      const centre =
        (i + 0.5) * cell + phase + (white(i, seed ^ 0x9e3779b9) - 0.5) * cell * 0.3 * opts.jitter
      const r = radius * (1 - 0.35 * opts.jitter * white(i, seed ^ 0x2545f491))
      const dx = s - centre
      if (dx > -r && dx < r) depth = Math.max(depth, Math.sqrt(r * r - dx * dx))
    }
    return depth
  },

  torn: (at) => {
    const { t, seed, peak, opts } = at
    const index = Math.round(t * (opts.samples - 1))
    const fibre = white(index * 2 + 1, seed ^ 0x1b873593)
    const wander = rough(t * opts.frequency, seed)
    return peak * clamp(wander * 0.8 + (fibre - 0.5) * 1.1 * opts.jitter, 0, 1)
  },

  deckled: (at) => {
    const { t, seed, peak, opts } = at
    return peak * (0.15 + 0.85 * regularise(swell(t * opts.frequency, seed), opts.jitter))
  },

  scalloped: (at) => {
    const { s, len, seed, peak, opts } = at
    const count = featureCount(len, opts)
    const cell = len / count
    const amplitude = Math.min(peak, cell * 0.4)
    // Max half a cell of drift, so the run stays aligned with the edge.
    const shift = (white(0, seed) - 0.5) * 0.5
    const index = Math.floor(s / cell + shift)
    const within = (s / cell + shift - index) * 2 - 1
    const scale = 1 - 0.3 * opts.jitter * white(index + 1, seed ^ 0x68e31da4)
    return amplitude * scale * Math.sqrt(Math.max(0, 1 - within * within))
  },

  /** Falloff is measured around the perimeter, and the focus comes from the caller's seed, so there is one fire, not four. */
  scorched: (at) => {
    const { t, u, root, seed, peak, opts } = at
    const focus = white(0, root ^ 0x5eed1e11)
    const away = Math.abs(u - focus)
    const around = Math.min(away, 1 - away)
    const reach = 0.06 + opts.spread * 0.5
    const falloff = Math.exp(-((around / reach) ** 2))
    return peak * falloff * (0.3 + 0.7 * regularise(rough(t * opts.frequency, seed ^ 0x1f83d9ab), opts.jitter))
  },

  frayed: (at) => {
    const { s, len, seed, peak, opts } = at
    const count = featureCount(len, opts)
    const cell = len / count
    const index = Math.floor(s / cell)
    const within = s / cell - index
    const tooth = 1 - Math.abs(2 * within - 1)
    const length = 0.25 + 0.75 * white(index, seed)
    return peak * length * tooth * (1 - 0.4 * opts.jitter * white(index, seed ^ 0x2f7c9e11))
  },

  nibbled: (at) => {
    const { t, s, len, seed, peak, opts } = at
    const count = featureCount(len, opts)
    const cell = len / count
    const scatter = Math.min(cell * 0.5, peak * 3)
    let depth = 0
    for (let c = 0; c < count; c++) {
      const centre = (c + 0.5) * cell + (white(c, seed) - 0.5) * cell * 0.5 * opts.jitter
      const teeth = 2 + Math.floor(white(c, seed ^ 0x51ed270b) * 4)
      for (let k = 0; k < teeth; k++) {
        const key = c * 5 + k
        const r = Math.min(peak, scatter) * (0.3 + 0.7 * white(key, seed ^ 0x2545f491))
        const biteAt = centre + (white(key, seed ^ 0x9e3779b1) - 0.5) * scatter * 2
        const dx = s - biteAt
        if (dx > -r && dx < r) depth = Math.max(depth, Math.sqrt(r * r - dx * dx))
      }
    }
    return depth + peak * 0.1 * opts.jitter * rough(t * opts.frequency, seed ^ 0x7f4a7c15)
  },

  chipped: (at) => {
    const { s, len, seed, peak, opts } = at
    const count = featureCount(len, opts)
    const cell = len / count
    let depth = 0
    for (let i = 0; i < count; i++) {
      const centre = (i + 0.5) * cell + (white(i, seed) - 0.5) * cell * 0.7 * opts.jitter
      const halfWidth = Math.min(peak * (0.7 + 0.8 * white(i, seed ^ 0x68e31da4)), cell * 0.6)
      const dx = Math.abs(s - centre)
      if (dx < halfWidth) depth = Math.max(depth, peak * (1 - dx / halfWidth))
    }
    return depth
  },
}

interface Vertex {
  x: number
  y: number
}

function boxPath(w: number, h: number): string {
  return `polygon(0px 0px, ${num(w)}px 0px, ${num(w)}px ${num(h)}px, 0px ${num(h)}px)`
}

/** Drops a vertex that rounds onto its predecessor; a zero-length segment would falsify the self-intersection reasoning. */
function push(vertices: Vertex[], x: number, y: number): void {
  const rx = round2(x)
  const ry = round2(y)
  const last = vertices[vertices.length - 1]
  if (last !== undefined && last.x === rx && last.y === ry) return
  vertices.push({ x: rx, y: ry })
}

function buildBox(style: EdgeStyle, w: number, h: number, root: number, opts: ResolvedEdge): string {
  const peak = opts.depth * Math.min(w, h)
  if (!(peak > 0) || !(w > 0) || !(h > 0)) return boxPath(w, h)

  const perimeter = 2 * (w + h)
  const profile = PROFILES[style]
  const treatment = CORNER_TREATMENT[style]
  // Just past the deepest possible bite, so no chain can reach a corner square.
  const inset = treatment === 'cut' ? peak * 1.05 : 0
  const ramp = treatment === 'keep' ? peak * CORNER_RAMP : 0
  const vertices: Vertex[] = []
  const at: EdgeSample = {
    t: 0,
    s: 0,
    u: 0,
    len: 0,
    side: 0,
    seed: root,
    root,
    peak,
    opts,
  }

  // Clockwise on screen, so the signed area of the walk is positive and inversion is a sign flip.
  for (let side = 0; side < 4; side++) {
    const len = side % 2 === 0 ? w : h
    const start = side === 0 ? 0 : side === 1 ? w : side === 2 ? w + h : 2 * w + h
    at.len = len
    at.side = side
    at.seed = sideSeed(root, side)

    for (let i = 0; i < opts.samples; i++) {
      const t = opts.samples > 1 ? i / (opts.samples - 1) : 0
      // A cut side samples only its middle; a kept side samples the full length and leans on the ramp.
      const s = inset + t * (len - 2 * inset)
      at.t = t
      at.s = s
      at.u = (start + s) / perimeter

      const raw = profile(at)
      // Belt and braces: a profile bug must not write "NaN" or fold the outline.
      let depth = Number.isFinite(raw) ? clamp(raw, 0, peak) : 0
      if (ramp > 0) depth *= Math.min(1, s / ramp, (len - s) / ramp)

      if (side === 0) push(vertices, s, depth)
      else if (side === 1) push(vertices, w - depth, s)
      else if (side === 2) push(vertices, w - s, h - depth)
      else push(vertices, depth, h - s)
    }
  }

  const first = vertices[0]
  const last = vertices[vertices.length - 1]
  if (first !== undefined && last !== undefined && first.x === last.x && first.y === last.y) {
    vertices.pop()
  }
  if (vertices.length < 3) return boxPath(w, h)

  return `polygon(${vertices.map((v) => `${num(v.x)}px ${num(v.y)}px`).join(', ')})`
}

const cache = new Map<string, string>()

function remember(key: string, value: string): void {
  if (cache.size >= EDGE_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

export function clearEdgeCache(): void {
  cache.clear()
}

export function edgeCacheSize(): number {
  return cache.size
}

/** Unknown styles fall back to clean, so a setting from a newer build cannot blank every pin. */
export function edgeClipPath(
  style: EdgeStyle,
  width: number,
  height: number,
  seed = 0,
  options?: EdgeOptions,
): string {
  const known: EdgeStyle = EDGE_PRESETS[style] !== undefined ? style : 'clean'
  const w = extent(width)
  const h = extent(height)
  const root = seed | 0
  const opts = resolve(known, options)
  const key = `${known}|${w}|${h}|${root}|${opts.key}`

  const hit = cache.get(key)
  if (hit !== undefined) return hit

  // Clean ignores options entirely.
  const clip = known === 'clean' ? boxPath(w, h) : buildBox(known, w, h, root, opts)
  remember(key, clip)
  return clip
}
