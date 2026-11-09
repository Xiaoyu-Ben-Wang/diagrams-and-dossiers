// Which snapshots a board keeps. Mirrors `prune_board_snapshots` in
// supabase/migrations/0012_board_snapshots.sql, with days in local time rather
// than UTC because these live in one person's browser.

export const HOUR_MS = 60 * 60 * 1000;
export const HOURLY_WINDOW_MS = 24 * HOUR_MS;
export const DAILY_KEEP_MS = 30 * 24 * HOUR_MS;

export interface Timed {
  takenAt: number;
}

export function localDay(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Everything from the last 24 hours, the last snapshot of each older day, none
 * past 30 days, and always the newest one, however old.
 */
export function survivors<T extends Timed>(
  snapshots: readonly T[],
  now: number,
  dayOf: (at: number) => string = localDay,
): T[] {
  const newestFirst = [...snapshots].sort((a, b) => b.takenAt - a.takenAt);
  const seenDays = new Set<string>();
  const kept: T[] = [];

  newestFirst.forEach((snapshot, index) => {
    const day = dayOf(snapshot.takenAt);
    const lastOfDay = !seenDays.has(day);
    seenDays.add(day);

    const age = now - snapshot.takenAt;
    if (index === 0) kept.push(snapshot);
    else if (age > DAILY_KEEP_MS) return;
    else if (age <= HOURLY_WINDOW_MS || lastOfDay) kept.push(snapshot);
  });

  return kept;
}

export type RecordPlan = "skip" | "add";

/**
 * Whether to save a version: at most one per hour, none for a board unchanged
 * since the last one, and none for an empty board with no history yet.
 */
export function planRecord(
  latest: Timed | null,
  now: number,
  changed: boolean,
  empty: boolean,
): RecordPlan {
  if (latest === null) return empty ? "skip" : "add";
  if (Math.floor(latest.takenAt / HOUR_MS) === Math.floor(now / HOUR_MS))
    return "skip";
  return changed ? "add" : "skip";
}
