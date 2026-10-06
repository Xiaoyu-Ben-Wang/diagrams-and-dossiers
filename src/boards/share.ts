// The link to a board, and putting it on the clipboard.
//
// One function builds the URL, so the day an id becomes a real token the change
// is here and nowhere else.

import { BASE_PATH, withBase } from '../app/router'
import type { BoardRecord } from './board-record'

export function shareUrlFor(
  record: BoardRecord,
  origin: string,
  base: string = BASE_PATH,
): string {
  return new URL(withBase(`/b/${encodeURIComponent(record.id)}`, base), origin).toString()
}

/** False when the platform will not take it — a dead button is worse than a field. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
