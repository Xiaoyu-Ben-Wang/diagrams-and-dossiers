import { describe, expect, it } from 'vitest'

import {
  activeAt,
  buildTimeline,
  clusterAt,
  clusterTimeline,
  positionOf,
  ticksFor,
  timeAt,
  type TimelineEntry,
} from './timeline'

const DAY = 24 * 60 * 60 * 1000
/** A fixed epoch so these tests don't depend on the machine's timezone. */
const T0 = Date.UTC(2026, 0, 1)

const entry = (id: string, dayOffset: number | null, label?: string): TimelineEntry => ({
  id,
  occurredAt: dayOffset === null ? null : T0 + dayOffset * DAY,
  dateLabel: label ?? null,
})

describe('buildTimeline', () => {
  it('sorts dated entries ascending regardless of input order', () => {
    const timeline = buildTimeline([entry('c', 20), entry('a', 0), entry('b', 10)])
    expect(timeline.placed.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('routes undated entries to their own tray rather than dropping them', () => {
    const timeline = buildTimeline([entry('a', 0), entry('floating', null), entry('b', 5)])
    expect(timeline.placed.map((e) => e.id)).toEqual(['a', 'b'])
    expect(timeline.undated.map((e) => e.id)).toEqual(['floating'])
  })

  it('keeps a free-text label verbatim, for homebrew calendars', () => {
    // The whole reason for the label/timestamp split: "3rd of Eleint" has to
    // display exactly as written while still sorting by its real date.
    const timeline = buildTimeline([entry('a', 0, '3rd of Eleint, 1492 DR')])
    expect(timeline.placed[0].dateLabel).toBe('3rd of Eleint, 1492 DR')
  })

  it('falls back to a formatted date when no label was given', () => {
    const timeline = buildTimeline([entry('a', 0)])
    expect(timeline.placed[0].dateLabel).toBeTruthy()
    expect(timeline.placed[0].dateLabel).not.toBe('')
  })

  it('reports the domain bounds', () => {
    const timeline = buildTimeline([entry('a', 10), entry('b', 3)])
    expect(timeline.start).toBe(T0 + 3 * DAY)
    expect(timeline.end).toBe(T0 + 10 * DAY)
  })

  it('handles an entirely undated board', () => {
    const timeline = buildTimeline([entry('a', null), entry('b', null)])
    expect(timeline.placed).toEqual([])
    expect(timeline.undated).toHaveLength(2)
  })

  it('handles an empty board', () => {
    const timeline = buildTimeline([])
    expect(timeline.placed).toEqual([])
    expect(timeline.start).toBe(0)
    expect(timeline.end).toBe(0)
  })

  it('treats a non-finite timestamp as undated rather than as 1970', () => {
    const timeline = buildTimeline([{ id: 'bad', occurredAt: Number.NaN, dateLabel: null }])
    expect(timeline.placed).toEqual([])
    expect(timeline.undated.map((e) => e.id)).toEqual(['bad'])
  })
})

describe('positionOf', () => {
  const timeline = buildTimeline([entry('a', 0), entry('b', 10)])

  it('maps the domain ends to 0 and 1', () => {
    expect(positionOf(timeline.start, timeline)).toBe(0)
    expect(positionOf(timeline.end, timeline)).toBe(1)
  })

  it('interpolates in between', () => {
    expect(positionOf(T0 + 5 * DAY, timeline)).toBeCloseTo(0.5, 9)
  })

  it('clamps outside the domain', () => {
    expect(positionOf(T0 - 100 * DAY, timeline)).toBe(0)
    expect(positionOf(T0 + 100 * DAY, timeline)).toBe(1)
  })

  it('centres everything when there is no span to interpolate across', () => {
    // A single dated entry, or several on the same day. Dividing by a zero span
    // would be NaN, and NaN in a scrubber position is a blank ribbon.
    const single = buildTimeline([entry('a', 0)])
    expect(positionOf(single.start, single)).toBe(0.5)

    const sameDay = buildTimeline([entry('a', 0), entry('b', 0)])
    expect(positionOf(sameDay.start, sameDay)).toBe(0.5)
  })
})

describe('timeAt', () => {
  const timeline = buildTimeline([entry('a', 0), entry('b', 10)])

  it('is the inverse of positionOf', () => {
    for (const t of [0, 0.25, 0.5, 0.9, 1]) {
      const time = timeAt(t, timeline)
      expect(positionOf(time, timeline)).toBeCloseTo(t, 9)
    }
  })

  it('clamps out-of-range positions', () => {
    expect(timeAt(-1, timeline)).toBe(timeline.start)
    expect(timeAt(2, timeline)).toBe(timeline.end)
  })
})

describe('clusterTimeline', () => {
  it('returns nothing for an empty timeline', () => {
    expect(clusterTimeline(buildTimeline([]))).toEqual([])
  })

  it('groups entries from one session together', () => {
    // Game night: several events on consecutive days.
    const timeline = buildTimeline([entry('a', 0), entry('b', 1), entry('c', 2)])
    const clusters = clusterTimeline(timeline)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].size).toBe(3)
    expect(clusters[0].from).toBe(0)
    expect(clusters[0].to).toBe(2)
  })

  it('splits on a gap longer than the threshold', () => {
    // Two sessions a fortnight apart.
    const timeline = buildTimeline([entry('a', 0), entry('b', 1), entry('c', 20), entry('d', 21)])
    const clusters = clusterTimeline(timeline)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].size).toBe(2)
    expect(clusters[1].size).toBe(2)
  })

  it('respects a custom gap', () => {
    const timeline = buildTimeline([entry('a', 0), entry('b', 4)])
    expect(clusterTimeline(timeline, 5)).toHaveLength(1)
    expect(clusterTimeline(timeline, 3)).toHaveLength(2)
  })

  it('does not split on a gap exactly at the threshold', () => {
    const timeline = buildTimeline([entry('a', 0), entry('b', 5)])
    expect(clusterTimeline(timeline, 5)).toHaveLength(1)
  })

  it('handles every entry being its own cluster', () => {
    const timeline = buildTimeline([entry('a', 0), entry('b', 100), entry('c', 200)])
    expect(clusterTimeline(timeline)).toHaveLength(3)
  })

  it('produces non-overlapping, gap-free index ranges covering every entry', () => {
    const timeline = buildTimeline([
      entry('a', 0),
      entry('b', 1),
      entry('c', 30),
      entry('d', 31),
      entry('e', 32),
      entry('f', 90),
    ])
    const clusters = clusterTimeline(timeline)

    expect(clusters[0].from).toBe(0)
    expect(clusters[clusters.length - 1].to).toBe(timeline.placed.length - 1)
    for (let i = 1; i < clusters.length; i++) {
      expect(clusters[i].from).toBe(clusters[i - 1].to + 1)
    }
    expect(clusters.reduce((sum, c) => sum + c.size, 0)).toBe(timeline.placed.length)
  })
})

describe('activeAt', () => {
  const timeline = buildTimeline([entry('a', 0), entry('b', 10), entry('c', 20)])

  it('shows the case as it stood at that moment', () => {
    expect(activeAt(timeline, T0 + 10 * DAY)).toEqual(['a', 'b'])
  })

  it('is empty before the first event', () => {
    expect(activeAt(timeline, T0 - DAY)).toEqual([])
  })

  it('includes everything at the end', () => {
    expect(activeAt(timeline, T0 + 100 * DAY)).toEqual(['a', 'b', 'c'])
  })

  it('widens with an explicit window', () => {
    expect(activeAt(timeline, T0, 10)).toEqual(['a', 'b'])
  })
})

describe('clusterAt', () => {
  const timeline = buildTimeline([entry('a', 0), entry('b', 1), entry('c', 30), entry('d', 31)])
  const clusters = clusterTimeline(timeline)

  it('finds the cluster a time falls inside', () => {
    expect(clusterAt(clusters, T0 + DAY)).toBe(clusters[0])
    expect(clusterAt(clusters, T0 + 30 * DAY)).toBe(clusters[1])
  })

  it('falls back to the nearest earlier cluster between sessions', () => {
    expect(clusterAt(clusters, T0 + 15 * DAY)).toBe(clusters[0])
  })

  it('falls back to the first cluster before the timeline starts', () => {
    expect(clusterAt(clusters, T0 - 100 * DAY)).toBe(clusters[0])
  })

  it('returns null when there are no clusters', () => {
    expect(clusterAt([], T0)).toBeNull()
  })
})

describe('ticksFor', () => {
  it('places one tick per cluster, not per entry', () => {
    const timeline = buildTimeline([entry('a', 0), entry('b', 0), entry('c', 0), entry('d', 30)])
    const clusters = clusterTimeline(timeline)
    const ticks = ticksFor(timeline, clusters)

    expect(ticks).toHaveLength(2)
    // Three entries on one day collapse to a single mark, so a busy session
    // doesn't turn the ribbon into a solid bar.
    expect(ticks[0].cluster.size).toBe(3)
  })

  it('places ticks within 0..1', () => {
    const timeline = buildTimeline([entry('a', 0), entry('b', 5), entry('c', 60)])
    for (const tick of ticksFor(timeline, clusterTimeline(timeline))) {
      expect(tick.position).toBeGreaterThanOrEqual(0)
      expect(tick.position).toBeLessThanOrEqual(1)
    }
  })
})
