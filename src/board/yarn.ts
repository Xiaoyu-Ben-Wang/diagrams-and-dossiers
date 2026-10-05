/**
 * Yarn geometry.
 *
 * A string between two pins is not a straight line and not an arbitrary curve —
 * it hangs. Getting the sag right is most of what makes the board read as a
 * physical object rather than a diagram, so the model is physical rather than
 * decorative:
 *
 * A rope of length L spanning a gap d has slack s = L - d. For small slack the
 * catenary is well approximated by a parabola, and the sag at the midpoint
 * works out to
 *
 *     sag = sqrt(3 · d · s / 8)
 *
 * The useful property is that sag grows with the *square root* of slack, not
 * linearly: a string pulled almost taut stays almost straight, and then droops
 * quickly as you give it rope. That sub-linear response is what the hand
 * expects, and a naive `sag = k · distance` reads as wrong without anyone being
 * able to say why.
 *
 * Everything here is pure — no DOM, no React, no timers — so the geometry is
 * testable and can be driven from the single rAF loop without touching state.
 */

export interface Point {
  x: number
  y: number
}

/** How much rope a string has, as a fraction of the gap it spans. */
export const DEFAULT_SLACK = 0.18

/** Beyond this the sag stops growing — otherwise long strings balloon off-screen. */
export const MAX_SAG_RATIO = 0.55

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Midpoint sag for a rope spanning `gap` with `slack` rope to spare.
 *
 * `slack` is a fraction of the gap, so the same value behaves consistently on
 * both a 40px string and a 900px one.
 */
export function sagFor(gap: number, slack: number = DEFAULT_SLACK): number {
  if (gap <= 0) return 0
  const spare = Math.max(0, slack) * gap
  const sag = Math.sqrt((3 * gap * spare) / 8)
  return Math.min(sag, gap * MAX_SAG_RATIO)
}

/**
 * The slack that droops `sag` px over `gap` — the inverse of `sagFor`.
 *
 * This is what lets a hand set the sag directly. `sagFor` grows as the square
 * root of slack, so a drag that moved slack linearly would feel dead near taut
 * and absurdly sensitive when loose; inverting instead means the string follows
 * the pointer one-for-one. Slack is scale-free (a fraction of the gap), so the
 * expression reduces to `8·(sag/gap)²/3` and behaves identically on a 40px
 * string and a 900px one.
 *
 * Only the unclamped branch is inverted. Beyond `MAX_SAG_RATIO` the sag is
 * pinned, so callers clamp the SAG first — `MAX_SLACK` is where that lands.
 */
export function slackForSag(gap: number, sag: number): number {
  if (gap <= 0) return 0
  const ratio = Math.max(0, sag) / gap
  return (8 * ratio * ratio) / 3
}

/**
 * The slack beyond which a string cannot droop any further.
 *
 * `sagFor` caps sag at `MAX_SAG_RATIO · gap`, and this is the slack that
 * reaches that cap — the same value for every gap, which is the point of slack
 * being a fraction. Dragging past it would otherwise keep raising slack while
 * nothing moved, and would store a number that no longer described the string.
 */
export const MAX_SLACK = (8 * MAX_SAG_RATIO * MAX_SAG_RATIO) / 3

/** The control point that makes a quadratic bezier hang like the rope would. */
export function controlPoint(from: Point, to: Point, slack: number = DEFAULT_SLACK): Point {
  const gap = distance(from, to)
  const middle = midpoint(from, to)
  return { x: middle.x, y: middle.y + sagFor(gap, slack) }
}

/** An SVG path for a string. Layered under the pins; never carries interaction. */
export function yarnPath(from: Point, to: Point, slack: number = DEFAULT_SLACK): string {
  const control = controlPoint(from, to, slack)
  return `M ${round(from.x)} ${round(from.y)} Q ${round(control.x)} ${round(control.y)} ${round(to.x)} ${round(to.y)}`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** A point along the hanging curve, by parameter (not arc length). */
export function pointOnYarn(from: Point, to: Point, t: number, slack: number = DEFAULT_SLACK): Point {
  const control = controlPoint(from, to, slack)
  const inverse = 1 - t
  return {
    x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
    y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
  }
}

/**
 * Shortest distance from a point to the string.
 *
 * Used for hit-testing: clicking a string should select it even though it's a
 * thin curve, and sampling is more than accurate enough at this scale. Returns
 * both the distance and the `t` of the nearest sample, so a caller can place a
 * label or a delete affordance on the string itself.
 */
export function distanceToYarn(
  from: Point,
  to: Point,
  point: Point,
  slack: number = DEFAULT_SLACK,
  samples = 24,
): { distance: number; t: number } {
  let best = { distance: Number.POSITIVE_INFINITY, t: 0 }

  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const current = pointOnYarn(from, to, t, slack)
    const d = Math.hypot(current.x - point.x, current.y - point.y)
    if (d < best.distance) best = { distance: d, t }
  }

  return best
}

/**
 * Where a string should attach on a card of the given size.
 *
 * Strings connect to the nearest edge midpoint rather than to the centre, so
 * they emerge from the side of a note that faces the thing it connects to
 * instead of disappearing under it.
 */
export function anchorOnBox(box: { x: number; y: number; width: number; height: number }, towards: Point): Point {
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const dx = towards.x - centre.x
  const dy = towards.y - centre.y

  if (dx === 0 && dy === 0) return centre

  // Scale the direction vector until it meets the box edge.
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : box.width / 2 / Math.abs(dx)
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : box.height / 2 / Math.abs(dy)
  const scale = Math.min(scaleX, scaleY)

  return { x: centre.x + dx * scale, y: centre.y + dy * scale }
}

/**
 * A damped spring, used to make the free end of a string trail the cursor
 * rather than snap to it.
 *
 * Integrated with a fixed timestep from the board clock. Stiffness and damping
 * are exposed because the feel matters more than the physics: the string should
 * lag just enough to look like it has weight.
 */
export interface Spring {
  value: number
  velocity: number
  stiffness: number
  damping: number
}

export function createSpring(value: number, stiffness = 170, damping = 18): Spring {
  return { value, velocity: 0, stiffness, damping }
}

/** Advance a spring towards `target` by `dt` seconds. Mutates and returns it. */
export function stepSpring(spring: Spring, target: number, dt: number): Spring {
  // Clamp dt so a backgrounded tab doesn't integrate one enormous step and
  // fling the value to infinity when it wakes up.
  const step = Math.min(dt, 1 / 30)
  const acceleration = (target - spring.value) * spring.stiffness - spring.velocity * spring.damping
  spring.velocity += acceleration * step
  spring.value += spring.velocity * step
  return spring
}

/** True once a spring has effectively settled and can stop being integrated. */
export function springAtRest(spring: Spring, target: number, epsilon = 0.05): boolean {
  return Math.abs(spring.value - target) < epsilon && Math.abs(spring.velocity) < epsilon
}

/**
 * Every string is the same red.
 *
 * This replaces a palette that picked a colour per connection. That made some
 * strings vanish rather than merely look plain: 'bone' (#d8cfb8) over the
 * parchment of a note card (#f7efdd) is a contrast ratio of about 1.2:1, and a
 * string spends most of its length crossing exactly those cards. A single red
 * holds up on both the cork and the paper, and a board of strings is easier to
 * read when the colour carries no meaning to decode.
 */
export const YARN_COLOR = '#a3302b'
