// A board as the library holds it: the document plus the little that makes it a
// thing you can name, order and point at. Shaped after the `boards` table, minus
// everything that is a server's business — `slug`, `owner_id` and the three
// capability tokens. Minting those locally would imply an access check that does
// not exist here.

import type { BoardState } from "../board/store";

export interface BoardRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  board: BoardState;
}

export const DEFAULT_BOARD_NAME = "Untitled board";

/** `crypto.randomUUID` where it exists; a v4 from raw bytes where it does not. */
export function newBoardId(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();

  if (crypto?.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }

  // Neither is available on very old engines; an id only has to be unique here.
  return `b-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function createBoardRecord(
  name: string,
  board: BoardState,
  now: number = Date.now(),
  id: string = newBoardId(),
): BoardRecord {
  return {
    id,
    name: name.trim() || DEFAULT_BOARD_NAME,
    createdAt: now,
    updatedAt: now,
    board,
  };
}

/** Total, like `parsePreferences`: a bad record costs one board, not the library. */
export function parseBoardRecord(raw: unknown): BoardRecord | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const value = raw as Record<string, unknown>;

  const id = typeof value.id === "string" && value.id !== "" ? value.id : null;
  const name =
    typeof value.name === "string" && value.name.trim() !== ""
      ? value.name.trim()
      : null;
  if (id === null || name === null) return null;

  const createdAt = finite(value.createdAt) ?? 0;
  return {
    id,
    name,
    createdAt,
    updatedAt: finite(value.updatedAt) ?? createdAt,
    board: parseBoardState(value.board),
  };
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Loose on purpose: this document was written by this app, not handed to it. */
function parseBoardState(raw: unknown): BoardState {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { entities: [], strings: [] };
  }
  const value = raw as Record<string, unknown>;
  return {
    entities: Array.isArray(value.entities)
      ? (value.entities as BoardState["entities"])
      : [],
    strings: Array.isArray(value.strings)
      ? (value.strings as BoardState["strings"])
      : [],
  };
}

/** The first page's title — what `boardFileName` already names a board's file after. */
export function boardNameFrom(board: BoardState): string | null {
  const article = board.entities.find((entity) => entity.kind === "article");
  const title = article?.title?.trim();
  return title ? title : null;
}

/** "Evidence" twice is two boards nobody can tell apart in a list. */
export function uniqueBoardName(
  existing: readonly string[],
  wanted: string,
): string {
  const base = wanted.trim() || DEFAULT_BOARD_NAME;
  if (!existing.includes(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!existing.includes(candidate)) return candidate;
  }
}
