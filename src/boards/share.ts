// The link to a board, and putting it on the clipboard.
//
// The link is the board's own address. Whether it opens for someone else is the
// server's decision — `open_board` lets them in only while the board is shared —
// so the link itself carries no secret. A board that never reached the server
// has no address anyone else can open, which the caller has to say something
// about rather than a URL to make up.

import { BASE_PATH, withBase } from "../app/router";
import type { BoardRecord } from "./board-record";

export function shareUrlFor(
  record: BoardRecord,
  origin: string,
  base: string = BASE_PATH,
): string | null {
  if (record.remote !== true) return null;
  return new URL(
    withBase(`/b/${encodeURIComponent(record.id)}`, base),
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
