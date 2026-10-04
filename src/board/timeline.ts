/**
 * The chronology ribbon.
 *
 * Items carry two date fields by design: a free-text `date_label` that displays
 * verbatim ("3rd of Eleint, 1492 DR") and a sortable `occurredAt` that orders
 * them. That split is what lets a homebrew calendar, a vague date ("sometime in
 * the spring"), and a real-world session log all share one timeline — the label
 * is for reading, the timestamp is for sorting, and neither has to be a lie.
 *
 * Undated items are not dropped. They go to an "unsorted evidence" tray at the
 * head of the ribbon, because an item with no date is a normal state during a
 * campaign, not an error.
 */

export interface TimelineEntry {
  id: string
  /** Epoch milliseconds, or null when the item has no date yet. */
  occurredAt: number | null
  /** What to show the user. Falls back to a formatted date when absent. */
  dateLabel: string | null
}

export interface PlacedEntry extends TimelineEntry {
  occurredAt: number
  dateLabel: string
}

export interface Timeline {
  /** Dated entries, ascending. */
  placed: PlacedEntry[]
  /** Entries with no date, in their original order. */
  undated: TimelineEntry[]
  start: number
  end: number
}

export interface Cluster {
  /** Index of the first and last entry in `timeline.placed`. */
  from: number
  to: number
  start: number
  end: number
  size: number
}

/**
 * Group dated entries by proximity, so the ribbon can show sessions.
 *
 * A tabletop campaign is naturally episodic: a burst of events on game night,
 * then nothing for two weeks. Clustering on gaps recovers that rhythm without
 * asking anyone to tag sessions manually, which they would not reliably do.
 */
export const DEFAULT_CLUSTER_GAP_DAYS = 5

const DAY_MS = 24 * 60 * 60 * 1000

/** Build a timeline. `entries` need not be sorted. */
export function buildTimeline(entries: TimelineEntry[]): Timeline {
  const placed: PlacedEntry[] = []
  const undated: TimelineEntry[] = []

  for (const entry of entries) {
    if (entry.occurredAt === null || !Number.isFinite(entry.occurredAt)) {
      undated.push(entry)
    } else {
      placed.push({
        ...entry,
        occurredAt: entry.occurredAt,
        dateLabel: entry.dateLabel ?? formatDate(entry.occurredAt),
      })
    }
  }

  placed.sort((a, b) => a.occurredAt - b.occurredAt)

  return {
    placed,
    undated,
    start: placed[0]?.occurredAt ?? 0,
    end: placed[placed.length - 1]?.occurredAt ?? 0,
  }
}

/**
 * Where a timestamp sits along the ribbon, 0 to 1.
 *
 * A timeline with one entry — or several on the same day — has no span to
 * interpolate across, so everything lands at the middle rather than at a
 * division-by-zero.
 */
export function positionOf(time: number, timeline: Timeline): number {
  const span = timeline.end - timeline.start
  if (span <= 0) return 0.5
  return Math.min(1, Math.max(0, (time - timeline.start) / span))
}

/** The time at a 0..1 position along the ribbon — the inverse of `positionOf`. */
export function timeAt(position: number, timeline: Timeline): number {
  const clamped = Math.min(1, Math.max(0, position))
  return timeline.start + clamped * (timeline.end - timeline.start)
}

/**
 * Split the timeline into clusters separated by more than `gapDays` of silence.
 *
 * Returns index ranges into `timeline.placed`, so callers can slice without
 * copying.
 */
export function clusterTimeline(
  timeline: Timeline,
  gapDays: number = DEFAULT_CLUSTER_GAP_DAYS,
): Cluster[] {
  const entries = timeline.placed
  if (entries.length === 0) return []

  const gap = gapDays * DAY_MS
  const clusters: Cluster[] = []

  let from = 0
  for (let i = 1; i <= entries.length; i++) {
    // A break belongs *before* i when the gap from i-1 to i exceeds the
    // threshold, or when i has run off the end.
    const broke = i === entries.length || entries[i].occurredAt - entries[i - 1].occurredAt > gap

    if (broke) {
      clusters.push({
        from,
        to: i - 1,
        start: entries[from].occurredAt,
        end: entries[i - 1].occurredAt,
        size: i - from,
      })
      from = i
    }
  }

  return clusters
}

/**
 * Which entries are "live" at a scrubbed time.
 *
 * The window is deliberately inclusive of everything from the beginning up to
 * `time`: scrubbing to a moment shows the case as it stood then, which is the
 * useful reading for a recap. A symmetric window would show events the party
 * had not yet lived through.
 */
export function activeAt(timeline: Timeline, time: number, windowDays = 0): string[] {
  const window = windowDays * DAY_MS
  return timeline.placed
    .filter((entry) => entry.occurredAt <= time + window)
    .map((entry) => entry.id)
}

/**
 * The cluster containing a given time, or the nearest one before it.
 *
 * Takes clusters rather than a timeline because that's genuinely all it needs —
 * clusters already carry their own start and end.
 */
export function clusterAt(clusters: Cluster[], time: number): Cluster | null {
  if (clusters.length === 0) return null

  let best: Cluster | null = null
  for (const cluster of clusters) {
    if (cluster.start <= time) best = cluster
    else break
  }

  return best ?? clusters[0]
}

/** Human-readable default when an item has no `date_label` of its own. */
export function formatDate(time: number): string {
  return new Date(time).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Tick marks for the ribbon.
 *
 * Ticks are placed per cluster rather than per entry, so a session with twenty
 * events produces one mark and a wide ribbon doesn't turn into a solid bar.
 */
export function ticksFor(
  timeline: Timeline,
  clusters: Cluster[],
): Array<{ position: number; cluster: Cluster }> {
  return clusters.map((cluster) => ({
    // A cluster is marked at its midpoint — its span can be a single instant,
    // in which case the midpoint is that instant.
    position: positionOf((cluster.start + cluster.end) / 2, timeline),
    cluster,
  }))
}
