/**
 * A click gives a collapsed caret inside a word, and a zero-length quote matches
 * everywhere, so a collapsed caret is snapped outward to the word it landed in.
 */

import type { TextAnchor } from "./types";

/** Context captured each side: enough to disambiguate, short enough to survive edits. */
export const CONTEXT_LENGTH = 32;

const WORD_CHARACTER = /[\p{L}\p{N}_'’-]/u;

function isWordCharacterAt(text: string, offset: number): boolean {
  if (offset < 0 || offset >= text.length) return false;
  return WORD_CHARACTER.test(text[offset]);
}

function expandWord(
  text: string,
  index: number,
): { start: number; end: number } {
  let start = index;
  let end = index + 1;
  while (start > 0 && isWordCharacterAt(text, start - 1)) start--;
  while (end < text.length && isWordCharacterAt(text, end)) end++;
  return { start, end };
}

/**
 * A caret at a word boundary is ambiguous; prefer the preceding word, as
 * double-click selection does. A caret in pure whitespace stays collapsed.
 */
export function snapToWord(
  text: string,
  offset: number,
): { start: number; end: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));

  if (isWordCharacterAt(text, clamped)) return expandWord(text, clamped);

  let probe = clamped - 1;
  while (probe >= 0 && !isWordCharacterAt(text, probe)) probe--;

  return probe >= 0
    ? expandWord(text, probe)
    : { start: clamped, end: clamped };
}

/**
 * A collapsed range is snapped to its surrounding word; if no word is adjacent
 * the quote is empty, which resolves as orphaned rather than pinning nowhere.
 */
export function createAnchor(
  text: string,
  start: number,
  end: number,
): TextAnchor {
  let from = Math.max(0, Math.min(start, text.length));
  let to = Math.max(0, Math.min(end, text.length));
  if (from > to) [from, to] = [to, from];

  if (from === to) {
    const snapped = snapToWord(text, from);
    from = snapped.start;
    to = snapped.end;
  }

  return {
    quote: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT_LENGTH), from),
    suffix: text.slice(to, to + CONTEXT_LENGTH),
    startOffset: from,
    endOffset: to,
  };
}
