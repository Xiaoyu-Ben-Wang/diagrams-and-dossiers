import deepEqual from "fast-deep-equal";

/**
 * Comparing two versions of the same shape.
 *
 * Undo and a rebase both need the same question answered: which fields did *this*
 * change touch? Restoring a whole entity would also revert whatever a peer did to
 * it in the meantime, so the answer has to be per-field.
 *
 * `fast-deep-equal` rather than a hand-rolled walk: a few hundred bytes, no
 * dependencies, and tuned for exactly this — which matters, because `commit` runs
 * it on every frame of a drag. It also gets `NaN` right, which the naive version
 * does not: `NaN !== NaN` would make every frame look like a change and quietly
 * break net-zero detection.
 */
export const sameValue = deepEqual;

/** The fields whose values differ, and so the fields a step meant to change. */
export function changedKeys<T extends object>(before: T, after: T): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    const from = (before as Record<string, unknown>)[key];
    const to = (after as Record<string, unknown>)[key];
    if (!sameValue(from, to)) changed.push(key);
  }
  return changed;
}

/** `current`, with the named fields taken from `from`. Everything else is kept. */
export function withFields<T extends object>(
  current: T,
  from: T,
  keys: readonly string[],
): T {
  const next = { ...current } as Record<string, unknown>;
  for (const key of keys) next[key] = (from as Record<string, unknown>)[key];
  return next as T;
}
