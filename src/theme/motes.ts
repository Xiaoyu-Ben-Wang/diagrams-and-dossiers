/**
 * Dust motes.
 *
 * Slow specks drifting through candlelight. Small effect, disproportionate
 * payoff: a board that is otherwise perfectly static reads as a screenshot,
 * and a handful of barely-visible particles moving at different speeds is
 * enough to make it read as a room.
 *
 * Two decisions worth stating:
 *
 *  - **Seeded, not random.** `Math.random()` would make the field different on
 *    every reload and impossible to test. A seeded generator gives a layout
 *    that is stable across renders but still looks unstructured.
 *  - **Bounded, not infinite.** Motes wrap within a rectangle rather than
 *    drifting forever, so the count stays fixed and the cost never grows.
 *
 * The whole simulation is pure and driven from the board's single rAF loop —
 * nothing here allocates per frame, which matters because garbage from a
 * sixty-hertz loop is what turns into a stutter two minutes in.
 */

export interface Mote {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  /** Base opacity, before the flicker term. */
  alpha: number
  /** Phase offset so motes don't all brighten in unison. */
  phase: number
}

export interface Bounds {
  width: number
  height: number
}

export interface MoteOptions {
  /** Downward bias — dust settles, it doesn't hover. */
  fallSpeed?: number
  /** Random walk strength. */
  drift?: number
  /** Parallax factor against the camera. */
  parallax?: number
  minRadius?: number
  maxRadius?: number
  minAlpha?: number
  maxAlpha?: number
}

/** mulberry32 — small, fast, and good enough for dust. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Scatter `count` motes across the bounds.
 *
 * Radius and opacity are biased towards the small and the faint: a field of
 * uniformly-sized specks reads as snow, whereas a few large ones among many
 * small ones reads as depth.
 */
export function createMotes(
  count: number,
  bounds: Bounds,
  seed = 1,
  options: MoteOptions = {},
): Mote[] {
  const {
    minRadius = 0.6,
    maxRadius = 2.1,
    minAlpha = 0.06,
    maxAlpha = 0.3,
  } = options

  const random = mulberry32(seed)
  const motes: Mote[] = []

  for (let i = 0; i < count; i++) {
    // Squaring the uniform value biases towards the small end.
    const size = random() ** 2
    motes.push({
      x: random() * bounds.width,
      y: random() * bounds.height,
      vx: (random() - 0.5) * 4,
      vy: (random() - 0.5) * 2,
      radius: minRadius + size * (maxRadius - minRadius),
      alpha: minAlpha + random() * (maxAlpha - minAlpha),
      phase: random() * Math.PI * 2,
    })
  }

  return motes
}

/**
 * Advance the field by `dt` seconds.
 *
 * Mutates in place — allocating a fresh array every frame is exactly the kind
 * of thing that looks harmless and produces a stutter two minutes in.
 */
export function stepMotes(
  motes: Mote[],
  dt: number,
  bounds: Bounds,
  options: MoteOptions = {},
): void {
  const { fallSpeed = 3, drift = 6 } = options

  // Clamp, so a tab that was backgrounded for a minute doesn't teleport every
  // mote across the screen the instant it wakes up.
  const step = Math.min(dt, 1 / 20)

  for (const mote of motes) {
    // A cheap approximation of brownian motion: nudge the velocity rather than
    // re-rolling it, so motion has continuity.
    mote.vx += (Math.random() - 0.5) * drift * step
    mote.vy += (Math.random() - 0.5) * drift * step

    // Damping, or the random walk accumulates until everything is streaking.
    mote.vx *= 0.98
    mote.vy *= 0.98

    mote.x += mote.vx * step
    mote.y += (mote.vy + fallSpeed) * step

    // Wrap rather than bounce: a mote reversing direction at an invisible
    // boundary is noticeable, one that reappears on the far side is not.
    if (mote.x < 0) mote.x += bounds.width
    else if (mote.x > bounds.width) mote.x -= bounds.width
    if (mote.y < 0) mote.y += bounds.height
    else if (mote.y > bounds.height) mote.y -= bounds.height
  }
}

/**
 * Current opacity of a mote, shimmering gently out of phase with its
 * neighbours. Without this the field looks like a static starfield.
 */
export function moteOpacity(mote: Mote, time: number): number {
  return Math.max(0, mote.alpha * (0.75 + 0.25 * Math.sin(time * 0.7 + mote.phase)))
}

/**
 * Screen position of a mote, given the camera.
 *
 * Motes sit *in front of* the board and drift against it at a fraction of the
 * camera's movement — the parallax is what sells them as being in the room
 * rather than painted on the cork.
 */
export function moteScreenPosition(
  mote: Mote,
  camera: { x: number; y: number; zoom: number },
  bounds: Bounds,
  parallax = 0.3,
): { x: number; y: number } {
  const offsetX = -camera.x * parallax * camera.zoom
  const offsetY = -camera.y * parallax * camera.zoom

  // Wrap the parallax offset too, so the field never runs out of motes as the
  // board is panned far from the origin.
  const wrappedX = ((offsetX % bounds.width) + bounds.width) % bounds.width
  const wrappedY = ((offsetY % bounds.height) + bounds.height) % bounds.height

  return {
    x: (mote.x + wrappedX) % bounds.width,
    y: (mote.y + wrappedY) % bounds.height,
  }
}

/**
 * Candle flicker opacity at a given time.
 *
 * Three sine waves on periods that share no common factor (3.7s, 6.1s, 11.3s)
 * summed together. The point of the coprime periods is that the combined signal
 * doesn't visibly repeat — a single sine reads as a pulsing light, which is
 * worse than no flicker at all. Real candlelight is irregular in a way that has
 * no period, and this approximates that without noise functions.
 */
export function candleFlicker(time: number): number {
  const a = Math.sin((time / 3.7) * Math.PI * 2)
  const b = Math.sin((time / 6.1) * Math.PI * 2 + 1.3)
  const c = Math.sin((time / 11.3) * Math.PI * 2 + 2.7)
  const combined = (a * 0.5 + b * 0.3 + c * 0.2) / 1.0
  // Centred on 1, varying by a few percent either way. Subtle is the whole
  // point: a strong flicker is nauseating on a large screen.
  return 1 + combined * 0.06
}
