/**
 * Margin-marker layout for the wiki view.
 *
 * Pins anchored in an article become markers in the margin, sitting at the
 * vertical position of the words they're attached to — the Google-Docs-comments
 * affordance. The problem is that anchors cluster: three pins on one paragraph
 * all want the same y, and if you draw them where they ask they overlap into an
 * unreadable pile.
 *
 * So markers are pushed apart to a minimum gap and a leader line is drawn back
 * to the anchor they belong to. That keeps two properties at once: every marker
 * is reachable, and every marker is visibly tied to its own words.
 *
 * The pass here is greedy and single-direction (top to bottom). That is
 * deliberate rather than lazy: a greedy pass keeps each marker as close to its
 * anchor as the ones above allow, which is exactly the behaviour you want. A
 * least-squares "balanced" pass would move markers *away* from their anchors to
 * spread the error evenly, and a marker that drifts from its text is worse than
 * one that sits a little low.
 */

export interface MarkerSlot {
  /** Index into the input array. */
  index: number
  /** Where the marker wants to be, in container coordinates. */
  anchorY: number
  /** Where it ended up. */
  markerY: number
  /** True when the marker had to move, so the caller should draw a leader. */
  displaced: boolean
}

export interface StackOptions {
  /** Minimum vertical distance between marker centres. */
  minGap?: number
  /** Keep the last marker at or above this y (usually the container height). */
  maxY?: number
  /** Don't push the first marker above this (usually 0). */
  minY?: number
}

export const DEFAULT_MIN_GAP = 34

/**
 * Push overlapping markers apart, preserving order.
 *
 * Returns one slot per input, in the *input* order — so callers can zip the
 * result back against their own array without sorting twice.
 */
export function stackMarkers(anchorYs: number[], options: StackOptions = {}): MarkerSlot[] {
  const { minGap = DEFAULT_MIN_GAP, maxY, minY } = options
  if (anchorYs.length === 0) return []

  const ordered = anchorYs
    .map((anchorY, index) => ({ anchorY, index }))
    .sort((a, b) => a.anchorY - b.anchorY || a.index - b.index)

  // If the markers can't all fit at the requested gap, compress rather than
  // overflow. Without this, the bottom-clamp and the top-clamp undo each other
  // and the stack oscillates out of the container entirely — which is what
  // happens on a short article with a dozen pins on it.
  let gap = minGap
  if (maxY !== undefined && minY !== undefined && anchorYs.length > 1) {
    const available = maxY - minY
    const needed = (anchorYs.length - 1) * minGap
    if (needed > available) gap = available / (anchorYs.length - 1)
  }

  // Forward pass: each marker sits at its anchor unless the one above is too
  // close, in which case it slides down just far enough to clear it.
  const placed = new Array<number>(anchorYs.length)
  let previous = Number.NEGATIVE_INFINITY

  for (const item of ordered) {
    const y = Math.max(item.anchorY, previous + gap)
    placed[item.index] = y
    previous = y
  }

  // If the stack ran past the bottom, lift the whole thing rather than letting
  // markers spill out of the article. Lifting uniformly keeps relative spacing,
  // so no marker is pushed *through* another.
  if (maxY !== undefined) {
    const lowest = placed[ordered[ordered.length - 1].index]
    const overflow = lowest - maxY
    if (overflow > 0) {
      for (let i = 0; i < placed.length; i++) placed[i] -= overflow
    }
  }

  // Never let the top marker escape above the container.
  if (minY !== undefined) {
    let highest = Number.POSITIVE_INFINITY
    for (const y of placed) highest = Math.min(highest, y)
    if (highest < minY) {
      const shift = minY - highest
      for (let i = 0; i < placed.length; i++) placed[i] += shift
    }
  }

  return anchorYs.map((anchorY, index) => ({
    index,
    anchorY,
    markerY: placed[index],
    // A tolerance rather than an equality check: sub-pixel drift isn't worth
    // drawing a leader line for, and it would flicker between renders.
    displaced: Math.abs(placed[index] - anchorY) > 0.5,
  }))
}

/**
 * Whether a marker has drifted far enough that a leader line is needed to keep
 * it legible. Short displacements read fine without one; a long one without a
 * leader is genuinely ambiguous about which words it belongs to.
 */
export function needsLeader(slot: MarkerSlot, tolerance = 6): boolean {
  return Math.abs(slot.markerY - slot.anchorY) > tolerance
}

/**
 * An SVG path from the anchor to the marker.
 *
 * Curved rather than straight: a bundle of straight leaders out of one paragraph
 * crosses itself into a knot, whereas a consistent horizontal bias keeps them
 * legible even when they overlap.
 */
export function leaderPath(
  anchorY: number,
  markerY: number,
  fromX: number,
  toX: number,
): string {
  const midX = (fromX + toX) / 2
  return `M ${round(fromX)} ${round(anchorY)} C ${round(midX)} ${round(anchorY)}, ${round(midX)} ${round(markerY)}, ${round(toX)} ${round(markerY)}`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Group markers that resolved to the same anchor position.
 *
 * Two pins on the same word are genuinely one place on the page; rendering them
 * as two markers a few pixels apart is noise. The caller renders one marker with
 * a count and expands on click.
 */
export function groupByAnchor<T>(
  items: T[],
  anchorYOf: (item: T) => number,
  tolerance = 2,
): Array<{ anchorY: number; items: T[] }> {
  const groups: Array<{ anchorY: number; items: T[] }> = []

  const sorted = items
    .map((item, index) => ({ item, anchorY: anchorYOf(item), index }))
    .sort((a, b) => a.anchorY - b.anchorY || a.index - b.index)

  for (const entry of sorted) {
    const last = groups[groups.length - 1]
    if (last && Math.abs(entry.anchorY - last.anchorY) <= tolerance) {
      last.items.push(entry.item)
    } else {
      groups.push({ anchorY: entry.anchorY, items: [entry.item] })
    }
  }

  return groups
}
