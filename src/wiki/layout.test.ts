import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MIN_GAP,
  groupByAnchor,
  leaderPath,
  needsLeader,
  stackMarkers,
} from './layout'

describe('stackMarkers', () => {
  it('returns nothing for nothing', () => {
    expect(stackMarkers([])).toEqual([])
  })

  it('leaves well-separated markers exactly where they asked to be', () => {
    const slots = stackMarkers([0, 100, 200])
    expect(slots.map((s) => s.markerY)).toEqual([0, 100, 200])
    expect(slots.every((s) => !s.displaced)).toBe(true)
  })

  it('pushes overlapping markers apart to the minimum gap', () => {
    // Three pins on one paragraph all want the same y. Without a pass they
    // stack into an unreadable pile.
    const slots = stackMarkers([100, 100, 100])
    expect(slots.map((s) => s.markerY)).toEqual([100, 100 + DEFAULT_MIN_GAP, 100 + 2 * DEFAULT_MIN_GAP])
  })

  it('keeps every marker at least minGap from its neighbour', () => {
    const slots = stackMarkers([10, 12, 14, 16, 60, 61], { minGap: 30 })
    const ys = slots.map((s) => s.markerY).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(30 - 1e-9)
    }
  })

  it('moves a marker no further than it must', () => {
    // The greedy property: a marker sits as close to its anchor as the one
    // above allows. A "balanced" pass would spread the error and drift markers
    // away from their text.
    const slots = stackMarkers([0, 10, 500], { minGap: 40 })
    expect(slots[0].markerY).toBe(0)
    expect(slots[1].markerY).toBe(40) // pushed just clear of the first
    expect(slots[2].markerY).toBe(500) // untouched, there was room
  })

  it('returns slots in input order even when the input is unsorted', () => {
    const slots = stackMarkers([500, 0, 250])
    // Sorted for layout, but zipped back against the caller's array.
    expect(slots[0].anchorY).toBe(500)
    expect(slots[1].anchorY).toBe(0)
    expect(slots[2].anchorY).toBe(250)
    expect(slots[1].markerY).toBeLessThan(slots[2].markerY)
    expect(slots[2].markerY).toBeLessThan(slots[0].markerY)
  })

  it('flags exactly the markers it had to move', () => {
    const slots = stackMarkers([0, 10, 500], { minGap: 40 })
    expect(slots.map((s) => s.displaced)).toEqual([false, true, false])
  })

  it('lifts the whole stack when it would run past the bottom', () => {
    // Better to shift the block than to let markers spill out of the article.
    const slots = stackMarkers([900, 900, 900], { minGap: 40, maxY: 1000 })
    const ys = slots.map((s) => s.markerY)
    expect(Math.max(...ys)).toBeLessThanOrEqual(1000)
    // Relative spacing survived the lift.
    expect(ys[1] - ys[0]).toBe(40)
    expect(ys[2] - ys[1]).toBe(40)
  })

  it('does not lift when the stack already fits', () => {
    const slots = stackMarkers([0, 100], { minGap: 40, maxY: 1000 })
    expect(slots.map((s) => s.markerY)).toEqual([0, 100])
  })

  it('keeps the top marker inside the container', () => {
    const slots = stackMarkers([-50, -40], { minGap: 40, minY: 0 })
    const ys = slots.map((s) => s.markerY)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
  })

  it('preserves order when both bounds apply', () => {
    const slots = stackMarkers([0, 5, 10, 15], { minGap: 50, minY: 0, maxY: 120 })
    const ys = slots.map((s) => s.markerY)
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1])
    }
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(120)
  })

  it('compresses the gap rather than overflowing when the window is too small', () => {
    // A short article with a dozen pins on it. The bounds cannot all be
    // honoured at the requested gap, so the gap gives way — letting markers
    // spill out of the article, or oscillating between the two clamps, are
    // both worse.
    const slots = stackMarkers([0, 0, 0, 0, 0, 0], { minGap: 50, minY: 0, maxY: 100 })
    const ys = slots.map((s) => s.markerY)

    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(100)
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1])
    }
  })

  it('handles a single marker', () => {
    const slots = stackMarkers([42])
    expect(slots).toHaveLength(1)
    expect(slots[0].markerY).toBe(42)
    expect(slots[0].displaced).toBe(false)
  })

  it('breaks ties deterministically by input index', () => {
    const first = stackMarkers([100, 100])
    const second = stackMarkers([100, 100])
    expect(first.map((s) => s.markerY)).toEqual(second.map((s) => s.markerY))
  })
})

describe('needsLeader', () => {
  it('is false for a marker sitting on its anchor', () => {
    expect(needsLeader({ index: 0, anchorY: 10, markerY: 10, displaced: false })).toBe(false)
  })

  it('tolerates sub-pixel drift so the leader does not flicker', () => {
    expect(needsLeader({ index: 0, anchorY: 10, markerY: 12, displaced: true })).toBe(false)
  })

  it('is true once the marker has clearly moved', () => {
    expect(needsLeader({ index: 0, anchorY: 10, markerY: 60, displaced: true })).toBe(true)
  })
})

describe('leaderPath', () => {
  it('starts at the anchor and ends at the marker', () => {
    const path = leaderPath(10, 90, 300, 360)
    expect(path.startsWith('M 300 10')).toBe(true)
    expect(path.endsWith('360 90')).toBe(true)
  })

  it('uses a cubic curve so bundled leaders do not cross into a knot', () => {
    expect(leaderPath(0, 100, 0, 60)).toContain('C')
  })

  it('is horizontal when there is nothing to correct', () => {
    const path = leaderPath(50, 50, 0, 60)
    expect(path).toBe('M 0 50 C 30 50, 30 50, 60 50')
  })
})

describe('groupByAnchor', () => {
  const items = [
    { id: 'a', y: 100 },
    { id: 'b', y: 100.5 },
    { id: 'c', y: 300 },
    { id: 'd', y: 100.2 },
  ]
  const yOf = (item: { y: number }) => item.y

  it('merges items wanting the same position', () => {
    // Two pins on the same word are one place on the page.
    const groups = groupByAnchor(items, yOf)
    expect(groups).toHaveLength(2)
    expect(groups[0].items.map((i) => i.id).sort()).toEqual(['a', 'b', 'd'])
    expect(groups[1].items.map((i) => i.id)).toEqual(['c'])
  })

  it('keeps groups in ascending order', () => {
    const shuffled = [{ id: 'x', y: 900 }, { id: 'y', y: 100 }, { id: 'z', y: 400 }]
    const groups = groupByAnchor(shuffled, yOf)
    expect(groups.map((g) => g.anchorY)).toEqual([100, 400, 900])
  })

  it('respects the tolerance', () => {
    const spread = [{ id: 'a', y: 0 }, { id: 'b', y: 10 }]
    expect(groupByAnchor(spread, yOf, 2)).toHaveLength(2)
    expect(groupByAnchor(spread, yOf, 20)).toHaveLength(1)
    expect(groupByAnchor(spread, yOf, 20)[0].anchorY).toBe(0)
  })

  it('returns nothing for nothing', () => {
    expect(groupByAnchor([], yOf)).toEqual([])
  })

  it('preserves the items themselves, not just their positions', () => {
    const groups = groupByAnchor(items, yOf)
    expect(groups[1].items[0]).toEqual({ id: 'c', y: 300 })
  })
})
