// The link to a board, and putting it on the clipboard.
//
// The link carries the board's edit token, not its id: §1's tokens are the door,
// and `join_board` is what turns one into a membership. A board that has never
// been published has no token and so has no link to offer — which is a state the
// caller has to say something about, not a URL to make up.

import { BASE_PATH, withBase } from "../app/router";
import type { BoardRecord } from "./board-record";

export function shareUrlFor(
  record: BoardRecord,
  origin: string,
  base: string = BASE_PATH,
): string | null {
  if (!record.editToken) return null;
  return new URL(
    withBase(`/j/${encodeURIComponent(record.editToken)}`, base),
    origin,
  ).toString();
}

/** False when the platform will not take it — a dead button is worse than a field. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText)
    return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
