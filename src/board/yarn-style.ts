import {
  DEFAULT_SLACK,
  YARN_COLOR,
  controlPoint,
  pointOnYarn,
  yarnPath,
} from "./yarn";
import type { Point } from "./yarn";

export const YARN_STYLES = [
  "minimal",
  "realistic",
  "plied",
  "cable",
  "plaid",
] as const;
export type YarnStyle = (typeof YARN_STYLES)[number];

/** One drawn pass. Path data only — the caller owns compositing. Paint order is array order. */
export interface YarnStrand {
  /** SVG path data in board space. */
  readonly d: string;
  /** Stroke width in board px. */
  readonly width: number;
  readonly opacity: number;
  /** Overrides the string's own colour; used for plies, bands, flecks and shadow. */
  readonly color?: string;
  /** `stroke-dasharray`, in board px. */
  readonly dash?: string;
  readonly dashOffset?: number;
  readonly cap?: "butt" | "round";
}

export interface FuzzOptions {
  /** Filaments in the fan, centre included. */
  strands?: number;
  /** Peak lateral wobble of a filament, in board px; absolute, not proportional. */
  amplitude?: number;
  /** Peak distance from the curve to an outermost filament, in board px. */
  spread?: number;
  /** Noise cycles along the string. */
  frequency?: number;
  /** Gauge of the wool in board px; every style is scaled from it. */
  width?: number;
  /** Vertices per filament. */
  samples?: number;
  /** Whether the string throws a shadow onto the board. */
  shadow?: boolean;
}

export const MAX_STRANDS = 12;

export const DEFAULT_FUZZ: Required<FuzzOptions> = {
  strands: 5,
  amplitude: 1.3,
  spread: 2.4,
  frequency: 4,
  width: 1.2,
  samples: 16,
  shadow: true,
};

/** Scale for 'minimal' so a solid stroke reads as the same yarn as the fan. */
const MINIMAL_GAUGE = 1.8;

const MIN_SAMPLES = 4;
const MAX_SAMPLES = 64;

/** Int32 avalanche (murmur3 finalizer); a cheap hash leaves visible banding. */
function hashLattice(cell: number, seed: number): number {
  let h = Math.imul(cell, 0x27d4eb2d) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise in [-1, 1], Lipschitz-bounded (slope ≤ 3); seeds must be integers. */
export function valueNoise(x: number, seed: number): number {
  const cell = Math.floor(x);
  const within = x - cell;
  const a = hashLattice(cell, seed);
  const b = hashLattice(cell + 1, seed);
  const fade = within * within * (3 - 2 * within);
  return (a + (b - a) * fade) * 2 - 1;
}

/** Irrational-ish so the octaves do not share zero crossings. */
const OCTAVE_RATIO = 2.37;
const OCTAVE_WEIGHT = 0.5;

function fbm(x: number, seed: number): number {
  const coarse = valueNoise(x, seed);
  const fine = valueNoise(x * OCTAVE_RATIO, seed ^ 0x5bf03635);
  return (coarse + OCTAVE_WEIGHT * fine) / (1 + OCTAVE_WEIGHT);
}

/** Stable seed for a key, so geometry does not reshuffle between reloads. */
export function seedFromKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

interface ResolvedFuzz {
  strands: number;
  amplitude: number;
  spread: number;
  frequency: number;
  width: number;
  samples: number;
  shadow: boolean;
  key: string;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** NaN/Infinity from a UI control must fall back, or it writes "NaN" into path data. */
function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function resolve(options?: FuzzOptions): ResolvedFuzz {
  if (options === undefined) return DEFAULT_RESOLVED;

  const strands = clamp(
    Math.round(finite(options.strands, DEFAULT_FUZZ.strands)),
    1,
    MAX_STRANDS,
  );
  const amplitude = Math.max(
    0,
    finite(options.amplitude, DEFAULT_FUZZ.amplitude),
  );
  const spread = Math.max(0, finite(options.spread, DEFAULT_FUZZ.spread));
  const frequency = Math.max(
    1,
    finite(options.frequency, DEFAULT_FUZZ.frequency),
  );
  const width = Math.max(0.05, finite(options.width, DEFAULT_FUZZ.width));
  const samples = clamp(
    Math.round(finite(options.samples, DEFAULT_FUZZ.samples)),
    MIN_SAMPLES,
    MAX_SAMPLES,
  );
  const shadow =
    options.shadow === undefined
      ? DEFAULT_FUZZ.shadow
      : Boolean(options.shadow);
  return {
    strands,
    amplitude,
    spread,
    frequency,
    width,
    samples,
    shadow,
    key: `${strands}|${amplitude}|${spread}|${frequency}|${width}|${samples}|${shadow}`,
  };
}

const DEFAULT_RESOLVED: ResolvedFuzz = {
  ...DEFAULT_FUZZ,
  key: `${DEFAULT_FUZZ.strands}|${DEFAULT_FUZZ.amplitude}|${DEFAULT_FUZZ.spread}|${DEFAULT_FUZZ.frequency}|${DEFAULT_FUZZ.width}|${DEFAULT_FUZZ.samples}|${DEFAULT_FUZZ.shadow}`,
};

/** Each filament must offset a different lattice index or they wobble in unison. */
function strandSeedFor(seed: number, index: number): number {
  return (seed + Math.imul(index + 1, 0x9e3779b1)) | 0;
}

// -0.5 at one edge, +0.5 at the other, so the fan is symmetric and the fuzz zero-mean.
function positionInFan(index: number, count: number): number {
  return count <= 1 ? 0 : index / (count - 1) - 0.5;
}

function offsetAt(
  t: number,
  index: number,
  count: number,
  seed: number,
  opts: ResolvedFuzz,
): number {
  // Exact zero at the ends so the first and last vertex land on the pin.
  if (t <= 0 || t >= 1) return 0;
  const bias = positionInFan(index, count) * opts.spread;
  const wobble =
    opts.amplitude * fbm(t * opts.frequency, strandSeedFor(seed, index));
  return Math.sin(Math.PI * t) * (bias + wobble);
}

/** Signed lateral offset along the curve's (-ty, tx) normal, in board px; zero at both ends. */
export function strandOffset(
  t: number,
  strandIndex: number,
  strandCount: number,
  seed: number,
  options?: FuzzOptions,
): number {
  const count = clamp(Math.round(finite(strandCount, 1)), 1, MAX_STRANDS);
  const index = clamp(Math.round(finite(strandIndex, 0)), 0, count - 1);
  return offsetAt(t, index, count, seed | 0, resolve(options));
}

/** Upper bound on a filament's distance from the curve, in board px. */
export function maxStrandDeviation(options?: FuzzOptions): number {
  const opts = resolve(options);
  return opts.spread / 2 + opts.amplitude;
}

/** Catmull-Rom, so the curve passes through every sample and starts and ends exactly on the pins. */
function smoothPath(
  xs: readonly number[],
  ys: readonly number[],
  tension = 1,
): string {
  const count = xs.length;
  if (count === 0) return "";
  if (count === 1) return `M ${round2(xs[0])} ${round2(ys[0])}`;
  if (count === 2) {
    return `M ${round2(xs[0])} ${round2(ys[0])} L ${round2(xs[1])} ${round2(ys[1])}`;
  }

  // /6 is the standard Catmull-Rom-to-Bezier constant.
  const k = tension / 6;
  let d = `M ${round2(xs[0])} ${round2(ys[0])}`;

  for (let i = 0; i < count - 1; i++) {
    const x0 = xs[i > 0 ? i - 1 : 0];
    const y0 = ys[i > 0 ? i - 1 : 0];
    const x1 = xs[i];
    const y1 = ys[i];
    const x2 = xs[i + 1];
    const y2 = ys[i + 1];
    const x3 = xs[i + 2 < count ? i + 2 : count - 1];
    const y3 = ys[i + 2 < count ? i + 2 : count - 1];

    const c1x = x1 + (x2 - x0) * k;
    const c1y = y1 + (y2 - y0) * k;
    const c2x = x2 - (x3 - x1) * k;
    const c2y = y2 - (y3 - y1) * k;

    d += ` C ${round2(c1x)} ${round2(c1y)}, ${round2(c2x)} ${round2(c2y)}, ${round2(x2)} ${round2(y2)}`;
  }

  return d;
}

function buildStrands(
  from: Point,
  to: Point,
  slack: number,
  seed: number,
  opts: ResolvedFuzz,
): readonly YarnStrand[] {
  const samples = opts.samples;
  const steps = samples - 1;
  const control = controlPoint(from, to, slack);

  const baseX = new Array<number>(samples);
  const baseY = new Array<number>(samples);
  const normalX = new Array<number>(samples);
  const normalY = new Array<number>(samples);

  for (let i = 0; i < samples; i++) {
    const t = i / steps;
    const base = pointOnYarn(from, to, t, slack);
    const inverse = 1 - t;
    // Offset along the analytic tangent's normal; pushing along x would shear steep strings.
    const tx = 2 * (inverse * (control.x - from.x) + t * (to.x - control.x));
    const ty = 2 * (inverse * (control.y - from.y) + t * (to.y - control.y));
    const length = Math.hypot(tx, ty);
    // Zero-length string collapses the fuzz to a point rather than an arbitrary direction.
    const inverseLength = length > 1e-9 ? 1 / length : 0;
    baseX[i] = base.x;
    baseY[i] = base.y;
    normalX[i] = -ty * inverseLength;
    normalY[i] = tx * inverseLength;
  }

  const strands: YarnStrand[] = [];
  for (let s = 0; s < opts.strands; s++) {
    const centrality = 1 - Math.abs(positionInFan(s, opts.strands)) * 2;

    const xs = new Array<number>(samples);
    const ys = new Array<number>(samples);
    for (let i = 0; i < samples; i++) {
      const offset = offsetAt(i / steps, s, opts.strands, seed, opts);
      xs[i] = baseX[i] + normalX[i] * offset;
      ys[i] = baseY[i] + normalY[i] * offset;
    }

    strands.push({
      // Centre filament thickest and most opaque; outer ones are hairlines.
      d: smoothPath(xs, ys),
      width: opts.width * (0.55 + 0.45 * centrality),
      opacity: 0.35 + 0.55 * centrality,
    });
  }

  return strands;
}

/** Returned array is shared with the cache — treat it as immutable. */
export function fuzzyStrands(
  from: Point,
  to: Point,
  slack: number = DEFAULT_SLACK,
  seed = 0,
  options?: FuzzOptions,
): readonly YarnStrand[] {
  const opts = resolve(options);
  const key = `realistic|${seed | 0}|${slack}|${pointKey(from)}|${pointKey(to)}|${opts.key}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const strands = buildStrands(from, to, slack, seed | 0, opts);
  remember(key, strands);
  return strands;
}

/** Board-space direction the light travels; the sheen and the cast shadow both obey it. */
const LIGHT_X = -0.55;
const LIGHT_Y = -0.83;

const DEEP = "#6f1d19";
const LIT = "#c8664f";
const CREAM = "#e6d3b3";
/** A light band that stays in the wool's own family instead of sitting on top of it. */
const ROSE = "#d08063";
const CAST = "#140b07";

const MAX_PATTERN_SAMPLES = 200;

/** Each style's gauge, as a multiple of the shared wool width. */
const STYLE_GAUGE: Record<YarnStyle, number> = {
  minimal: MINIMAL_GAUGE,
  realistic: 2.0,
  plied: 2.0,
  cable: 2.8,
  plaid: 2.3,
};

interface Frame {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  /** Unit normal at each sample, (-ty, tx). */
  readonly nx: readonly number[];
  readonly ny: readonly number[];
  /** Cumulative chord length: 0 at `from`, 1 at `to`. */
  readonly arc: readonly number[];
  /** Total chord length in board px; never zero. */
  readonly length: number;
}

function frameOf(
  from: Point,
  to: Point,
  slack: number,
  samples: number,
): Frame {
  const control = controlPoint(from, to, slack);
  const steps = samples - 1;
  const xs = new Array<number>(samples);
  const ys = new Array<number>(samples);
  const nx = new Array<number>(samples);
  const ny = new Array<number>(samples);

  for (let i = 0; i < samples; i++) {
    const t = i / steps;
    const base = pointOnYarn(from, to, t, slack);
    const inverse = 1 - t;
    const tx = 2 * (inverse * (control.x - from.x) + t * (to.x - control.x));
    const ty = 2 * (inverse * (control.y - from.y) + t * (to.y - control.y));
    const length = Math.hypot(tx, ty);
    const inverseLength = length > 1e-9 ? 1 / length : 0;
    xs[i] = base.x;
    ys[i] = base.y;
    nx[i] = -ty * inverseLength;
    ny[i] = tx * inverseLength;
  }

  const arc = new Array<number>(samples);
  let total = 0;
  arc[0] = 0;
  for (let i = 1; i < samples; i++) {
    total += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    arc[i] = total;
  }

  const length = total > 1e-9 ? total : 1;
  for (let i = 0; i < samples; i++) arc[i] /= length;

  return { xs, ys, nx, ny, arc, length };
}

/** Fine enough that one turn of the twist is a curve rather than a zigzag. */
function samplesFor(length: number, pitch: number): number {
  return clamp(
    Math.round(length / Math.max(1.5, pitch / 5)),
    16,
    MAX_PATTERN_SAMPLES,
  );
}

/** Exact zero at both ends, so a twist gathers onto the tack instead of waving past it. */
function windowAt(t: number): number {
  return Math.sin(Math.PI * t);
}

function polylinePath(xs: readonly number[], ys: readonly number[]): string {
  let d = `M ${round2(xs[0])} ${round2(ys[0])}`;
  for (let i = 1; i < xs.length; i++)
    d += ` L ${round2(xs[i])} ${round2(ys[i])}`;
  return d;
}

/** A thread spiralling the spine. The offset is along the normal, so it follows every sag. */
function helixPath(
  frame: Frame,
  amplitude: number,
  pitch: number,
  phase: number,
): string {
  const count = frame.xs.length;
  const xs = new Array<number>(count);
  const ys = new Array<number>(count);

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const angle = (2 * Math.PI * frame.arc[i] * frame.length) / pitch + phase;
    const offset = amplitude * Math.sin(angle) * windowAt(t);
    xs[i] = frame.xs[i] + frame.nx[i] * offset;
    ys[i] = frame.ys[i] + frame.ny[i] * offset;
  }

  return polylinePath(xs, ys);
}

/** The lit core slides to the light side on a bend, which is what reads as roundness. */
function corePath(frame: Frame, radius: number): string {
  const count = frame.xs.length;
  const xs = new Array<number>(count);
  const ys = new Array<number>(count);

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const facing = frame.nx[i] * LIGHT_X + frame.ny[i] * LIGHT_Y;
    const offset = radius * clamp(facing, -1, 1) * windowAt(t);
    xs[i] = frame.xs[i] + frame.nx[i] * offset;
    ys[i] = frame.ys[i] + frame.ny[i] * offset;
  }

  return smoothPath(xs, ys);
}

/**
 * Thrown down and to the right, because that is the side the light is not, and given extra
 * slack so it hangs below the string — the extra droop is a fraction of the sag, so a taut
 * string throws its shadow almost directly under itself and a slack one throws it clear.
 */
const SHADOW_SAG = 1.08;

function castShadow(
  from: Point,
  to: Point,
  slack: number,
  gauge: number,
): YarnStrand {
  const drop = gauge * 0.4;
  return {
    d: yarnPath(
      { x: from.x + drop * 0.6, y: from.y + drop },
      { x: to.x + drop * 0.6, y: to.y + drop },
      slack * SHADOW_SAG,
    ),
    width: gauge * 1.2,
    opacity: 0.34,
    color: CAST,
    cap: "round",
  };
}

function pliedStrands(
  from: Point,
  to: Point,
  slack: number,
  gauge: number,
  samples: number,
): readonly YarnStrand[] {
  const body = frameOf(from, to, slack, samples);
  const pitch = gauge * 5;
  const twist = frameOf(from, to, slack, samplesFor(body.length, pitch));

  return [
    {
      d: yarnPath(from, to, slack),
      width: gauge * 0.66,
      opacity: 1,
      color: DEEP,
      cap: "round",
    },
    {
      d: helixPath(twist, gauge * 0.3, pitch, 0),
      width: gauge * 0.6,
      opacity: 0.95,
      color: YARN_COLOR,
      cap: "round",
    },
    {
      d: helixPath(twist, gauge * 0.3, pitch, Math.PI),
      width: gauge * 0.6,
      opacity: 0.8,
      color: LIT,
      cap: "round",
    },
    {
      d: corePath(body, gauge * 0.16),
      width: gauge * 0.3,
      opacity: 0.5,
      color: CREAM,
    },
  ];
}

function cableStrands(
  from: Point,
  to: Point,
  slack: number,
  gauge: number,
  samples: number,
): readonly YarnStrand[] {
  const body = frameOf(from, to, slack, samples);
  const pitch = gauge * 4.2;
  const twist = frameOf(from, to, slack, samplesFor(body.length, pitch));
  const amplitude = gauge * 0.34;
  const phase = (2 * Math.PI) / 3;

  return [
    {
      d: yarnPath(from, to, slack),
      width: gauge * 0.7,
      opacity: 1,
      color: DEEP,
      cap: "round",
    },
    {
      d: helixPath(twist, amplitude, pitch, 0),
      width: gauge * 0.72,
      opacity: 1,
      color: YARN_COLOR,
      cap: "round",
    },
    {
      d: helixPath(twist, amplitude, pitch, phase),
      width: gauge * 0.72,
      opacity: 0.7,
      color: LIT,
      cap: "round",
    },
    {
      d: helixPath(twist, amplitude, pitch, phase * 2),
      width: gauge * 0.72,
      opacity: 0.9,
      color: DEEP,
      cap: "round",
    },
    {
      d: corePath(body, gauge * 0.18),
      width: gauge * 0.32,
      opacity: 0.45,
      color: CREAM,
    },
  ];
}

function plaidStrands(
  from: Point,
  to: Point,
  slack: number,
  gauge: number,
  samples: number,
): readonly YarnStrand[] {
  const body = frameOf(from, to, slack, samples);
  const pitch = gauge * 3.4;

  const bands = yarnPath(from, to, slack);

  return [
    {
      d: bands,
      width: gauge * 1.05,
      opacity: 1,
      color: YARN_COLOR,
      cap: "round",
    },
    {
      d: bands,
      width: gauge * 1.05,
      opacity: 0.85,
      color: ROSE,
      dash: `${gauge * 1.2} ${gauge * 2.3}`,
      cap: "butt",
    },
    {
      d: bands,
      width: gauge * 1.05,
      opacity: 0.8,
      color: DEEP,
      dash: `${gauge * 1.1} ${gauge * 4.1}`,
      dashOffset: gauge * 2,
      cap: "butt",
    },
    {
      d: helixPath(
        frameOf(from, to, slack, samplesFor(body.length, pitch)),
        gauge * 0.3,
        pitch,
        0,
      ),
      width: gauge * 0.3,
      opacity: 0.4,
      color: LIT,
      cap: "round",
    },
  ];
}

function buildStyled(
  style: YarnStyle,
  from: Point,
  to: Point,
  slack: number,
  gauge: number,
  samples: number,
): readonly YarnStrand[] {
  switch (style) {
    case "plied":
      return pliedStrands(from, to, slack, gauge, samples);
    case "cable":
      return cableStrands(from, to, slack, gauge, samples);
    case "plaid":
      return plaidStrands(from, to, slack, gauge, samples);
    default:
      return [{ d: yarnPath(from, to, slack), width: gauge, opacity: 1 }];
  }
}

export function yarnStrands(
  style: YarnStyle,
  from: Point,
  to: Point,
  slack: number = DEFAULT_SLACK,
  seed = 0,
  options?: FuzzOptions,
): readonly YarnStrand[] {
  const opts = resolve(options);
  const key = `${style}|${seed | 0}|${slack}|${pointKey(from)}|${pointKey(to)}|${opts.key}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const gauge = opts.width * STYLE_GAUGE[style];
  const body =
    style === "realistic"
      ? fuzzyStrands(from, to, slack, seed, options)
      : buildStyled(style, from, to, slack, gauge, opts.samples);
  // The shadow is one layer over whichever style was chosen, so the switch means the same
  // thing everywhere rather than only on the styles that happened to draw one.
  const strands = opts.shadow
    ? [castShadow(from, to, slack, gauge), ...body]
    : body;

  remember(key, strands);
  return strands;
}

const CACHE_LIMIT = 2048;

const cache = new Map<string, readonly YarnStrand[]>();

function remember(key: string, value: readonly YarnStrand[]): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

export function clearYarnStyleCache(): void {
  cache.clear();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pointKey(point: Point): string {
  return `${round2(point.x)},${round2(point.y)}`;
}
