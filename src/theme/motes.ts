export interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  /** Phase offset so motes don't all brighten in unison. */
  phase: number;
}

export interface Bounds {
  width: number;
  height: number;
}

export interface MoteOptions {
  fallSpeed?: number;
  drift?: number;
  parallax?: number;
  minRadius?: number;
  maxRadius?: number;
  minAlpha?: number;
  maxAlpha?: number;
}

/** mulberry32. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  } = options;

  const random = mulberry32(seed);
  const motes: Mote[] = [];

  for (let i = 0; i < count; i++) {
    // Squaring the uniform value biases towards the small end.
    const size = random() ** 2;
    motes.push({
      x: random() * bounds.width,
      y: random() * bounds.height,
      vx: (random() - 0.5) * 4,
      vy: (random() - 0.5) * 2,
      radius: minRadius + size * (maxRadius - minRadius),
      alpha: minAlpha + random() * (maxAlpha - minAlpha),
      phase: random() * Math.PI * 2,
    });
  }

  return motes;
}

/** Mutates in place; a fresh array every frame produces a stutter. */
export function stepMotes(
  motes: Mote[],
  dt: number,
  bounds: Bounds,
  options: MoteOptions = {},
): void {
  const { fallSpeed = 3, drift = 6 } = options;

  // Clamp, so a backgrounded tab doesn't teleport every mote across the screen on wake.
  const step = Math.min(dt, 1 / 20);

  for (const mote of motes) {
    mote.vx += (Math.random() - 0.5) * drift * step;
    mote.vy += (Math.random() - 0.5) * drift * step;

    // Damping, or the random walk accumulates into streaks.
    mote.vx *= 0.98;
    mote.vy *= 0.98;

    mote.x += mote.vx * step;
    mote.y += (mote.vy + fallSpeed) * step;

    if (mote.x < 0) mote.x += bounds.width;
    else if (mote.x > bounds.width) mote.x -= bounds.width;
    if (mote.y < 0) mote.y += bounds.height;
    else if (mote.y > bounds.height) mote.y -= bounds.height;
  }
}

export function moteOpacity(mote: Mote, time: number): number {
  return Math.max(
    0,
    mote.alpha * (0.75 + 0.25 * Math.sin(time * 0.7 + mote.phase)),
  );
}

export function moteScreenPosition(
  mote: Mote,
  camera: { x: number; y: number; zoom: number },
  bounds: Bounds,
  parallax = 0.3,
): { x: number; y: number } {
  const offsetX = -camera.x * parallax * camera.zoom;
  const offsetY = -camera.y * parallax * camera.zoom;

  const wrappedX = ((offsetX % bounds.width) + bounds.width) % bounds.width;
  const wrappedY = ((offsetY % bounds.height) + bounds.height) % bounds.height;

  return {
    x: (mote.x + wrappedX) % bounds.width,
    y: (mote.y + wrappedY) % bounds.height,
  };
}

// Coprime periods (3.7s, 6.1s, 11.3s) so the summed signal does not visibly repeat.
export function candleFlicker(time: number): number {
  const a = Math.sin((time / 3.7) * Math.PI * 2);
  const b = Math.sin((time / 6.1) * Math.PI * 2 + 1.3);
  const c = Math.sin((time / 11.3) * Math.PI * 2 + 2.7);
  const combined = (a * 0.5 + b * 0.3 + c * 0.2) / 1.0;
  // Centred on 1, varying a few percent either way — a strong flicker is nauseating.
  return 1 + combined * 0.06;
}
