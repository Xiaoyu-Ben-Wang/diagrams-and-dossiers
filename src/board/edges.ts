/**
 * Edge cropping.
 *
 * Paper does not arrive with a perfect border. This module turns a *style* and
 * a *size* into the CSS `clip-path` that bites that border off — charred, torn,
 * stamped, deckled — so a pin reads as a physical object rather than as a div.
 *
 * Three decisions worth stating up front:
 *
 *  - **Geometry, never filters.** The crop is a polygon of sampled points, so it
 *    rasterizes once and then costs nothing to pan or zoom. `feTurbulence` /
 *    `feDisplacementMap` — or the CSS `filter` that wraps them — re-rasterize a
 *    pin's whole subtree on every frame, which a board of a few hundred pins
 *    cannot pay for. ./yarn-style.ts is built on the same rule.
 *
 *  - **Seeded, not random.** `Math.random()` would re-crack every edge on every
 *    reload, so a burnt memo would be burnt differently tomorrow and no test
 *    could pin the geometry down. Callers seed from the pin's own identity via
 *    `seedFromKey`, which gives both properties at once: one pin's edge is
 *    stable forever, and two pins of the same style differ because their ids
 *    differ. The hand-damaged look comes from the seed, not from entropy.
 *
 *  - **Depth is proportional, not absolute.** Every option that describes a
 *    distance is a fraction of the box's SHORT side. A fixed pixel bite sized
 *    for a 600px photograph vanishes on a 90px note, and the caller cannot be
 *    asked to pre-scale: pins are resized by the user, not by us.
 *
 * The outline has to be SIMPLE — no self-intersections — or the clip renders as
 * wedges and its area stops meaning anything. Displacing each side on its own
 * does not give that for free: two adjacent sides can each reach into the same
 * corner square and cross there, which is what the obvious per-side walk does.
 * So every style picks one of two corner treatments that are simple by
 * construction (`CORNER_TREATMENT`):
 *
 *   cut  — the sample run is inset past each corner by slightly more than the
 *          deepest possible bite, and the join between adjacent sides draws the
 *          diagonal that knocks the corner off. Neither chain enters the corner
 *          square, so they cannot meet inside it.
 *   keep — the run spans the whole side and every depth is scaled by a linear
 *          ramp that vanishes at the corner. A chain then sits at most
 *          peak * x / R deep at distance x from a corner, and a crossing would
 *          need x <= peak*y/R and y <= peak*x/R at once — unsatisfiable once
 *          R > peak.
 *
 * COST: one build walks four sides at `samples` vertices each, evaluating a
 * closed-form profile per vertex; the styles that place discrete bites also
 * scan their features (bounded at one per three vertices, see `featureCount`).
 * That is a few hundred arithmetic ops and under 250 vertices per edge, and it
 * happens once per style/size/seed — results are cached on exactly that key,
 * bounded and evicted oldest-first, the way ./yarn-style.ts caches strands. A
 * re-render or a camera move is then a Map lookup per pin.
 *
 * Everything here is pure and seedable: identical arguments yield a
 * byte-identical clip-path string, which is what makes the cache sound, the
 * output testable, and a board that reloads look like the board you left.
 */

import { seedFromKey, valueNoise } from './yarn-style'

/**
 * Re-exported because an edge is seeded from the same identity the caller uses
 * for everything else about a pin — one hashing scheme, so a pin's yarn and its
 * torn corner are derived from the same id.
 */
export { seedFromKey }

/**
 * The edge forms.
 *
 * The first four are the named ones. The rest are inventions, and each is a
 * different KIND of damage rather than a different noise amplitude: a deckled
 * edge is smooth where a torn one is ragged, stamped perforates where scalloped
 * ripples, scorched is asymmetric where burnt is uniform, and chipped leaves
 * long straight runs where everything else is continuously damaged. At board
 * zoom they must be tellable apart at a glance, so no two are noise at
 * different volumes.
 */
export const EDGE_STYLES = [
  'clean',
  'burnt',
  'stamped',
  'torn',
  'deckled',
  'scalloped',
  'scorched',
  'frayed',
  'nibbled',
  'chipped',
] as const

export type EdgeStyle = (typeof EDGE_STYLES)[number]

/**
 * Per-style knobs. Every field is optional and every style has its own default
 * (see `EDGE_PRESETS`); a caller only ever overrides what its settings pane
 * exposes, and the rest of the style's character survives.
 */
export interface EdgeOptions {
  /**
   * Peak inward bite as a fraction of the box's short side. Clamped to
   * [0, MAX_DEPTH_RATIO] — see that constant for why the ceiling exists.
   */
  depth?: number
  /** Undulations along a side, in cycles, for the styles that use a wave. */
  frequency?: number
  /**
   * How irregular the damage is allowed to be, 0..1. Zero is the regular
   * ideal in every style: a flat even bite, placed features at even intervals,
   * no phase wobble. Damage should sit near 1.
   */
  jitter?: number
  /** Vertices per side. More is smoother and dearer. */
  samples?: number
  /** Discrete features per 100px of edge, for the styles that place them. */
  density?: number
  /** How far scorched's burn reaches around the perimeter, as a fraction of it. */
  spread?: number
}

export type EdgePreset = Required<EdgeOptions>

/**
 * The defaults each style is tuned to. Depths are fractions of the short side;
 * the four named forms sit around 5%, the soft paper forms around 2%, because
 * a deckled note and a burnt note are not damaged to the same degree.
 */
export const EDGE_PRESETS: Readonly<Record<EdgeStyle, EdgePreset>> = {
  clean: { depth: 0, frequency: 1, jitter: 1, samples: 6, density: 1, spread: 0.35 },
  burnt: { depth: 0.05, frequency: 5, jitter: 1, samples: 40, density: 6, spread: 0.35 },
  stamped: { depth: 0.055, frequency: 1, jitter: 0.35, samples: 48, density: 6, spread: 0.35 },
  torn: { depth: 0.05, frequency: 3, jitter: 0.9, samples: 44, density: 6, spread: 0.35 },
  deckled: { depth: 0.022, frequency: 2.5, jitter: 1, samples: 32, density: 6, spread: 0.35 },
  scalloped: { depth: 0.018, frequency: 1, jitter: 0.15, samples: 40, density: 5, spread: 0.35 },
  scorched: { depth: 0.07, frequency: 4, jitter: 1, samples: 40, density: 6, spread: 0.3 },
  frayed: { depth: 0.03, frequency: 1, jitter: 0.6, samples: 56, density: 8, spread: 0.35 },
  nibbled: { depth: 0.03, frequency: 1, jitter: 0.9, samples: 40, density: 3, spread: 0.35 },
  chipped: { depth: 0.06, frequency: 1, jitter: 0.9, samples: 36, density: 1.2, spread: 0.35 },
}

/**
 * How each style gets out of its corners. See the header for why this is not
 * merely cosmetic: it is the proof that the outline cannot fold.
 *
 * A cut corner is a corner that damage took off, so it belongs to the styles
 * that eat: burnt, torn, scorched, gnawed, chipped. A kept corner is a corner
 * that survived, so it belongs to the ones with a regular run along the edge —
 * a perforation, a scallop — and to cloth, which is cut square before it frays.
 */
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

/**
 * The hard ceiling on a bite, as a fraction of the box's short side.
 *
 * A crop must never eat the paper it is cropping. If every side were at this
 * depth at once — which no style does, but options alone must not be able to
 * break it — a square would still keep (1 - 2 x 0.07)^2 = 74% of its area. It
 * is also what keeps OPPOSITE sides apart: two sides at 7% of the short side
 * leave the middle 86% of the box untouched, so those two chains cannot meet
 * either, not just the adjacent ones the corner treatments handle.
 */
export const MAX_DEPTH_RATIO = 0.07

export const MIN_SAMPLES_PER_SIDE = 4
export const MAX_SAMPLES_PER_SIDE = 64

/** Bounded so a busy board's cache cannot creep; evicted oldest-first. */
export const EDGE_CACHE_LIMIT = 2048

const MIN_FREQUENCY = 0.25
const MAX_FREQUENCY = 24
const MIN_DENSITY = 0.2
const MAX_DENSITY = 40

/**
 * Ceiling on placed features per side, so the bite scan is O(24 x samples) at
 * worst however exotic the options are.
 */
const MAX_FEATURES_PER_SIDE = 24

/**
 * Vertices per placed feature. Three is the floor at which a bite reads as a
 * bite: sampled more coarsely, a round notch becomes a triangle and a hair
 * becomes a single zigzag, i.e. the shape stops being the shape. This is also
 * why `featureCount` shrinks the count on a long side rather than letting the
 * feature rate outrun the sample rate.
 */
const SAMPLES_PER_FEATURE = 3

/**
 * How far past the deepest bite a kept corner's ramp runs. Only that it exceeds
 * the peak matters for the proof; 1.5 keeps the fade short enough that the
 * damage still reaches near the corners.
 */
const CORNER_RAMP = 1.5

const OCTAVE_RATIO = 2.37
const OCTAVE_WEIGHT = 0.5

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

/**
 * Two octaves of the lattice noise from ./yarn-style.ts, rectified to [0, 1].
 *
 * Rectified because a bite depth cannot be negative: the walk displaces points
 * inward only. The constants match `fbm` there so both fields share a
 * character — the same continuity bound, the same "smooth but not periodic"
 * read — while the offset here is always outward from the box edge.
 */
function rough(x: number, seed: number): number {
  const coarse = valueNoise(x, seed)
  const fine = valueNoise(x * OCTAVE_RATIO, seed ^ 0x5bf03635)
  return 0.5 + 0.5 * ((coarse + OCTAVE_WEIGHT * fine) / (1 + OCTAVE_WEIGHT))
}

/**
 * One octave, so the undulation has no fine grain: a deckled edge is a long
 * soft swell, and adding the second octave would make it read as weathering.
 */
function swell(x: number, seed: number): number {
  return 0.5 + 0.5 * valueNoise(x, seed)
}

/**
 * A uniform draw in [0, 1) for feature `index`.
 *
 * At an integer cell `valueNoise` returns the raw lattice hash with no
 * interpolation, so it doubles as the per-feature RNG. That reuses the same
 * murmur3 avalanche as the smooth field rather than adding a second, weaker
 * hash beside it — and it means a feature's length and a nearby swell are drawn
 * from the same well.
 */
function white(index: number, seed: number): number {
  return (valueNoise(index, seed) + 1) / 2
}

/**
 * A style's own seed. Sharing one field across the four sides would make
 * opposite edges ripple in mirror image, which reads as a printed pattern
 * rather than as damage. The constant is the same golden-ratio mix
 * ./yarn-style.ts gives each strand, for the same reason.
 */
function sideSeed(seed: number, side: number): number {
  return (seed + Math.imul(side + 1, 0x9e3779b1)) | 0
}

/**
 * Pulls a [0,1] profile toward its mean as `jitter` drops, so one knob means
 * the same thing in every style: the regular ideal at 0, the tuned look at 1.
 */
function regularise(value: number, jitter: number): number {
  return 0.5 + (value - 0.5) * jitter
}

// ---------------------------------------------------------------------------
// Numeric guards
// ---------------------------------------------------------------------------

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}

/**
 * A numeric option fed from a UI control can be NaN (an emptied number box) or
 * Infinity. Clamping passes NaN straight through, which would write "NaN" into
 * a clip path the browser then refuses to parse — the pin loses its crop, or
 * worse, disappears — so fall back to the preset instead.
 */
function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback
}

/** Rounded to the 2dp the path is written at, so the cache key is exact. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * A box dimension. Non-finite and negative sizes have no meaningful edge, so
 * they collapse to zero and the caller gets the plain rectangle back; a zero
 * box is not an error worth throwing over, it is a pin that has not been
 * measured yet.
 */
function extent(value: number): number {
  return Number.isFinite(value) && value > 0 ? round2(value) : 0
}

function num(value: number): string {
  // -0 formats as "-0", which is legal CSS but an ugly cache key and an ugly
  // diff; normalising it keeps the output byte-stable.
  return String(value === 0 ? 0 : value)
}

// ---------------------------------------------------------------------------
// Resolved options
// ---------------------------------------------------------------------------

interface ResolvedEdge {
  depth: number
  frequency: number
  jitter: number
  samples: number
  density: number
  spread: number
  /** Stable identity of the resolved numbers, for the geometry cache. */
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

/**
 * The cached-path call lands here once per pin per render, so the default case
 * must not walk the clamps: the board resolves the same ten presets over and
 * over as pins are added.
 */
function resolve(style: EdgeStyle, options?: EdgeOptions): ResolvedEdge {
  return options === undefined ? DEFAULT_RESOLVED[style] : resolveFrom(style, options)
}

const DEFAULT_RESOLVED: Readonly<Record<EdgeStyle, ResolvedEdge>> = (() => {
  const table = {} as Record<EdgeStyle, ResolvedEdge>
  for (const style of EDGE_STYLES) table[style] = resolveFrom(style)
  return table
})()

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/**
 * The cursor a side walk hands to a profile.
 *
 * One object per edge, its fields rewritten per sample — never retained, and
 * never allocated per vertex, because a board rebuilds every visible edge on a
 * single camera move and per-sample garbage is what turns that into a stutter.
 * A profile reads only the fields it means to.
 */
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
  /** The caller's seed, for the few choices that must be global, not per-side. */
  root: number
  /** The depth ceiling in px, already resolved and clamped. */
  peak: number
  opts: ResolvedEdge
}

/** Returns an inward depth in px; the walk clamps it to [0, peak]. */
type ProfileFn = (at: EdgeSample) => number

/**
 * How many discrete features fit on a side.
 *
 * The `samples` cap is the important one: past one feature per three vertices
 * the polygon aliases — a bitten edge becomes a zigzag, which reads as noise
 * rather than as teeth. On a very long side this trades count for size, which
 * is the honest degradation: fewer, larger bites, still bites.
 */
function featureCount(len: number, opts: ResolvedEdge): number {
  const spacing = 100 / opts.density
  const bySamples = Math.max(1, Math.floor(opts.samples / SAMPLES_PER_FEATURE))
  return clamp(Math.round(len / spacing), 1, Math.min(MAX_FEATURES_PER_SIDE, bySamples))
}

const PROFILES: Readonly<Record<EdgeStyle, ProfileFn>> = {
  /** Never reached — `edgeClipPath` short-circuits clean to the plain box. */
  clean: () => 0,

  /**
   * Char: eaten fairly evenly all round, coarse patches and fine crumble. The
   * profile is clamped at zero by the walk, so a low spot keeps its paper,
   * which is what stops the char reading as a cut.
   */
  burnt: (at) => {
    const { t, seed, peak, opts } = at
    return peak * (0.35 + 0.65 * regularise(rough(t * opts.frequency, seed), opts.jitter))
  },

  /**
   * Perforated: evenly spaced round bites with the paper left between them.
   */
  stamped: (at) => {
    const { s, len, seed, peak, opts } = at
    const count = featureCount(len, opts)
    const cell = len / count
    // Capped below half a cell so bites can never merge into a continuous
    // wave, which would make this a scallop.
    const radius = Math.min(peak, cell * 0.38)
    let depth = 0
    for (let i = 0; i < count; i++) {
      const centre = (i + 0.5) * cell + (white(i, seed) - 0.5) * cell * 0.3 * opts.jitter
      const r = radius * (1 - 0.35 * opts.jitter * white(i, seed ^ 0x2545f491))
      const dx = s - centre
      if (dx > -r && dx < r) depth = Math.max(depth, Math.sqrt(r * r - dx * dx))
    }
    return depth
  },

  /**
   * Ragged: a wandering tear overridden by white noise, not a smooth field, so
   * adjacent vertices disagree and the edge reads as ragged rather than as a
   * wave. Clamped at zero, the low spots are the fibres that held — the few
   * places the tear ran along a grain instead of across it.
   */
  torn: (at) => {
    const { t, seed, peak, opts } = at
    const index = Math.round(t * (opts.samples - 1))
    const fibre = white(index * 2 + 1, seed ^ 0x1b873593)
    const wander = rough(t * opts.frequency, seed)
    return peak * clamp(wander * 0.8 + (fibre - 0.5) * 1.1 * opts.jitter, 0, 1)
  },

  /**
   * Handmade paper: long soft swells, no fine grain and no sharp turns, which
   * is the whole difference between deckled and torn.
   */
  deckled: (at) => {
    const { t, seed, peak, opts } = at
    return peak * (0.15 + 0.85 * regularise(swell(t * opts.frequency, seed), opts.jitter))
  },

  /**
   * A doily rim: shallow arcs that meet each other at the edge, so the run is
   * continuous with no flat between the scallops. Elliptical rather than
   * circular on purpose — a circle deep enough to read would be a stamped bite.
   */
  scalloped: (at) => {
    const { s, len, seed, peak, opts } = at
    const count = featureCount(len, opts)
    const cell = len / count
    const amplitude = Math.min(peak, cell * 0.4)
    // Never more than a quarter cell of drift, so the run stays aligned with the
    // edge and each side starts and ends near a zero crossing.
    const shift = (white(0, seed) - 0.5) * 0.25 * opts.jitter
    const index = Math.floor(s / cell + shift)
    const within = (s / cell + shift - index) * 2 - 1
    const scale = 1 - 0.3 * opts.jitter * white(index + 1, seed ^ 0x68e31da4)
    return amplitude * scale * Math.sqrt(Math.max(0, 1 - within * within))
  },

  /**
   * Caught from one side: a fire does not char a sheet evenly, it eats where it
   * started and fades with distance. The falloff is measured around the
   * PERIMETER, not across the box, which is what lets one burn take a corner
   * and both edges leading away from it while the far side stays whole. The
   * focus comes from the caller's seed, not the side's, so there is one fire
   * and not four.
   */
  scorched: (at) => {
    const { t, u, root, seed, peak, opts } = at
    const focus = white(0, root ^ 0x5eed1e11)
    const away = Math.abs(u - focus)
    const around = Math.min(away, 1 - away)
    const reach = 0.06 + opts.spread * 0.5
    const falloff = Math.exp(-((around / reach) ** 2))
    return peak * falloff * (0.3 + 0.7 * regularise(rough(t * opts.frequency, seed ^ 0x1f83d9ab), opts.jitter))
  },

  /**
   * Worn cloth: a comb of fine teeth, each hair its own length. Pointed
   * triangles rather than rounded lobes, and a higher density than anything
   * else here, so it reads as fibre at arm's length where torn reads as paper.
   */
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

  /**
   * Rat-gnawed: small bites in patches, because gnawing happens in one place
   * until the animal moves, with untouched runs in between. Deliberately
   * smaller and messier than stamped, and the runs keep a faint rasp so they
   * are not as straight as a chipped edge.
   */
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

  /**
   * Chipped like glaze or stone: long perfectly straight runs with a few
   * isolated gouges. Linear ramps rather than circular arcs — an angular notch
   * is what distinguishes a chip from a bite, and the untouched runs are what
   * make it read as a hard material instead of damaged paper.
   */
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

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface Vertex {
  x: number
  y: number
}

/** The plain rectangle: the clean style, and the fallback for a degenerate box. */
function boxPath(w: number, h: number): string {
  return `polygon(0px 0px, ${num(w)}px 0px, ${num(w)}px ${num(h)}px, 0px ${num(h)}px)`
}

/**
 * Append a vertex, dropping one that rounds onto its predecessor.
 *
 * Two samples can land on the same 2dp coordinate on a small box or a flat run;
 * left in, they emit zero-length segments that make every consumer's
 * self-intersection reasoning false.
 */
function push(vertices: Vertex[], x: number, y: number): void {
  const rx = round2(x)
  const ry = round2(y)
  const last = vertices[vertices.length - 1]
  if (last !== undefined && last.x === rx && last.y === ry) return
  vertices.push({ x: rx, y: ry })
}

function buildBox(style: EdgeStyle, w: number, h: number, root: number, opts: ResolvedEdge): string {
  const peak = opts.depth * Math.min(w, h)
  // Nothing to crop: either the caller asked for depth zero or the box has no
  // area (see `extent`). The plain rectangle is the honest answer, and it keeps
  // the output valid CSS for a pin that has not been measured yet.
  if (!(peak > 0) || !(w > 0) || !(h > 0)) return boxPath(w, h)

  const perimeter = 2 * (w + h)
  const profile = PROFILES[style]
  const treatment = CORNER_TREATMENT[style]
  // Just past the deepest possible bite, so no chain can reach a corner square
  // (cut) and every chain is at most peak * s / ramp deep (keep).
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

  // Clockwise in screen coordinates, so the signed area of the walk is positive
  // and an inverted shape is detectable as a sign flip rather than as a
  // mysterious hole.
  for (let side = 0; side < 4; side++) {
    const len = side % 2 === 0 ? w : h
    // Distance around the perimeter to this side's start: top, right, bottom,
    // left in walk order.
    const start = side === 0 ? 0 : side === 1 ? w : side === 2 ? w + h : 2 * w + h
    at.len = len
    at.side = side
    at.seed = sideSeed(root, side)

    for (let i = 0; i < opts.samples; i++) {
      const t = opts.samples > 1 ? i / (opts.samples - 1) : 0
      // A cut side samples only its middle, so the join to its neighbour draws
      // the corner off; a kept side samples the full length and leans on the
      // ramp instead.
      const s = inset + t * (len - 2 * inset)
      at.t = t
      at.s = s
      at.u = (start + s) / perimeter

      const raw = profile(at)
      // Belt as well as braces: a profile bug must not be able to write "NaN"
      // into a clip path, and a depth outside the ceiling must not be able to
      // fold the outline.
      let depth = Number.isFinite(raw) ? clamp(raw, 0, peak) : 0
      if (ramp > 0) depth *= Math.min(1, s / ramp, (len - s) / ramp)

      if (side === 0) push(vertices, s, depth)
      else if (side === 1) push(vertices, w - depth, s)
      else if (side === 2) push(vertices, w - s, h - depth)
      else push(vertices, depth, h - s)
    }
  }

  // The walk closes implicitly, so a final vertex identical to the first is
  // redundant (a kept left side ends exactly on the top-left corner, which the
  // top side opened with).
  const first = vertices[0]
  const last = vertices[vertices.length - 1]
  if (first !== undefined && last !== undefined && first.x === last.x && first.y === last.y) {
    vertices.pop()
  }
  // A polygon needs three points to be a polygon; anything less means the box
  // collapsed under rounding, and the rectangle is the safe answer.
  if (vertices.length < 3) return boxPath(w, h)

  return `polygon(${vertices.map((v) => `${num(v.x)}px ${num(v.y)}px`).join(', ')})`
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache = new Map<string, string>()

function remember(key: string, value: string): void {
  // Insertion order is the eviction order: the edges that have not been looked
  // at recently are the ones worth dropping.
  if (cache.size >= EDGE_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

/** For tests, and for anything that needs to prove a rebuild is honest. */
export function clearEdgeCache(): void {
  cache.clear()
}

/** For tests, and for watching the bound hold as pins are added. */
export function edgeCacheSize(): number {
  return cache.size
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * The CSS `clip-path` for a box of `width` x `height` rendered in `style`.
 *
 * Deterministic: the same arguments give a byte-identical string on every call,
 * in every process, cache or no cache. Different `seed`s give different damage,
 * which is how two burnt notes on the same board fail to look like copies —
 * seed each pin from its own id (`seedFromKey`).
 *
 * Unknown styles fall back to clean rather than throwing: a persisted setting
 * from a newer build must not blank every pin on the board.
 */
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

  // Clean means clean: options cannot damage it, which is the point of having a
  // no-crop member at all.
  const clip = known === 'clean' ? boxPath(w, h) : buildBox(known, w, h, root, opts)
  remember(key, clip)
  return clip
}
