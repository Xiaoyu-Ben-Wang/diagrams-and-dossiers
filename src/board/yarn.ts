export interface Point {
  x: number;
  y: number;
}

/** How much rope a string has, as a fraction of the gap it spans. */
export const DEFAULT_SLACK = 0.18;

/** Where a string's label sits by default: the middle of the rope. */
export const LABEL_AT_MIDDLE = 0.5;

export const MAX_SAG_RATIO = 0.55;

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function sagFor(gap: number, slack: number = DEFAULT_SLACK): number {
  if (gap <= 0) return 0;
  const spare = Math.max(0, slack) * gap;
  const sag = Math.sqrt((3 * gap * spare) / 8);
  return Math.min(sag, gap * MAX_SAG_RATIO);
}

/** Inverse of `sagFor`; callers clamp the sag to `MAX_SAG_RATIO · gap` first. */
export function slackForSag(gap: number, sag: number): number {
  if (gap <= 0) return 0;
  const ratio = Math.max(0, sag) / gap;
  return (8 * ratio * ratio) / 3;
}

/** The slack that reaches `sagFor`'s cap; must track `MAX_SAG_RATIO`. */
export const MAX_SLACK = (8 * MAX_SAG_RATIO * MAX_SAG_RATIO) / 3;

export function controlPoint(
  from: Point,
  to: Point,
  slack: number = DEFAULT_SLACK,
): Point {
  const gap = distance(from, to);
  const middle = midpoint(from, to);
  return { x: middle.x, y: middle.y + sagFor(gap, slack) };
}

/** SVG path data; never carries interaction. */
export function yarnPath(
  from: Point,
  to: Point,
  slack: number = DEFAULT_SLACK,
): string {
  const control = controlPoint(from, to, slack);
  return `M ${round(from.x)} ${round(from.y)} Q ${round(control.x)} ${round(control.y)} ${round(to.x)} ${round(to.y)}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A point along the hanging curve, by bezier parameter (not arc length). */
export function pointOnYarn(
  from: Point,
  to: Point,
  t: number,
  slack: number = DEFAULT_SLACK,
): Point {
  const control = controlPoint(from, to, slack);
  const inverse = 1 - t;
  return {
    x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
    y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
  };
}

/** Distance to the chords between samples, not to the samples themselves. */
export function distanceToYarn(
  from: Point,
  to: Point,
  point: Point,
  slack: number = DEFAULT_SLACK,
  samples = 24,
): { distance: number; t: number } {
  let best = { distance: Number.POSITIVE_INFINITY, t: 0 };
  let previous = pointOnYarn(from, to, 0, slack);

  for (let i = 1; i <= samples; i++) {
    const current = pointOnYarn(from, to, i / samples, slack);
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const span = dx * dx + dy * dy;
    // Measuring to the nearest sample leaves a gap of half a segment, which on a long
    // string is wider than the grab itself and makes a hover land and then miss.
    const along =
      span > 1e-12
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - previous.x) * dx + (point.y - previous.y) * dy) /
                span,
            ),
          )
        : 0;
    const nearX = previous.x + along * dx;
    const nearY = previous.y + along * dy;
    const distance = Math.hypot(nearX - point.x, nearY - point.y);

    if (distance < best.distance)
      best = { distance, t: (i - 1 + along) / samples };
    previous = current;
  }

  return best;
}

export function anchorOnBox(
  box: { x: number; y: number; width: number; height: number },
  towards: Point,
): Point {
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const dx = towards.x - centre.x;
  const dy = towards.y - centre.y;

  if (dx === 0 && dy === 0) return centre;

  const scaleX =
    dx === 0 ? Number.POSITIVE_INFINITY : box.width / 2 / Math.abs(dx);
  const scaleY =
    dy === 0 ? Number.POSITIVE_INFINITY : box.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);

  return { x: centre.x + dx * scale, y: centre.y + dy * scale };
}

/** What a new string is stored with. */
export { DEFAULT_YARN_COLOR as YARN_COLOR } from "./yarn-color";
