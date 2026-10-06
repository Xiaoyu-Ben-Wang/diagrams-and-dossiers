export interface TimelineEntry {
  id: string
  /** Epoch ms, or null when undated. */
  occurredAt: number | null
  dateLabel: string | null
}

export interface PlacedEntry extends TimelineEntry {
  occurredAt: number
  dateLabel: string
}

export interface Timeline {
  placed: PlacedEntry[]
  undated: TimelineEntry[]
  start: number
  end: number
}

export interface Cluster {
  /** Indices into `timeline.placed`. */
  from: number
  to: number
  start: number
  end: number
  size: number
}

export const DEFAULT_CLUSTER_GAP_DAYS = 5

const DAY_MS = 24 * 60 * 60 * 1000

/** `entries` need not be sorted. */
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

/** A zero span (one entry, or several on one day) puts everything at the middle. */
export function positionOf(time: number, timeline: Timeline): number {
  const span = timeline.end - timeline.start
  if (span <= 0) return 0.5
  return Math.min(1, Math.max(0, (time - timeline.start) / span))
}

export function timeAt(position: number, timeline: Timeline): number {
  const clamped = Math.min(1, Math.max(0, position))
  return timeline.start + clamped * (timeline.end - timeline.start)
}

/** Returns index ranges into `timeline.placed`, not copies. */
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
    // A break belongs before i when the gap exceeds the threshold, or i ran off the end.
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

/** Everything from the beginning up to `time`, not a symmetric window around it. */
export function activeAt(timeline: Timeline, time: number, windowDays = 0): string[] {
  const window = windowDays * DAY_MS
  return timeline.placed
    .filter((entry) => entry.occurredAt <= time + window)
    .map((entry) => entry.id)
}

export function clusterAt(clusters: Cluster[], time: number): Cluster | null {
  if (clusters.length === 0) return null

  let best: Cluster | null = null
  for (const cluster of clusters) {
    if (cluster.start <= time) best = cluster
    else break
  }

  return best ?? clusters[0]
}

export function formatDate(time: number): string {
  return new Date(time).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function ticksFor(
  timeline: Timeline,
  clusters: Cluster[],
): Array<{ position: number; cluster: Cluster }> {
  return clusters.map((cluster) => ({
    position: positionOf((cluster.start + cluster.end) / 2, timeline),
    cluster,
  }))
}
