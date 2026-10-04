/**
 * Creating an anchor from a position in an article's flat text.
 *
 * The caller's job is to get a flat offset range (from a DOM Selection, or from
 * a click resolved to a caret). This module's job is to decide what text that
 * position actually refers to.
 *
 * The subtlety: users *click* to pin, they don't select text first. A click
 * gives a collapsed caret sitting somewhere inside a word, and a zero-length
 * quote matches everywhere and resolves to nothing useful. So a collapsed caret
 * is snapped outward to the word it landed in.
 */

import type { TextAnchor } from './types'

/** How much context to capture on each side. Enough to disambiguate, short enough to survive edits. */
export const CONTEXT_LENGTH = 32

const WORD_CHARACTER = /[\p{L}\p{N}_'’-]/u

/** True if `offset` sits inside a word rather than in the space between words. */
function isWordCharacterAt(text: string, offset: number): boolean {
  if (offset < 0 || offset >= text.length) return false
  return WORD_CHARACTER.test(text[offset])
}

function expandWord(text: string, index: number): { start: number; end: number } {
  let start = index
  let end = index + 1
  while (start > 0 && isWordCharacterAt(text, start - 1)) start--
  while (end < text.length && isWordCharacterAt(text, end)) end++
  return { start, end }
}

/**
 * Expand a collapsed caret to the word it refers to.
 *
 * A caret at a word boundary is ambiguous — "foo| bar" could mean the end of
 * "foo" or the start of "bar". We prefer the preceding word, matching how
 * double-click selection behaves.
 *
 * A caret in pure whitespace stays collapsed, and the caller should treat the
 * anchor as unanchorable rather than guess.
 */
export function snapToWord(text: string, offset: number): { start: number; end: number } {
  const clamped = Math.max(0, Math.min(offset, text.length))

  // Caret landed inside a word: take that word.
  if (isWordCharacterAt(text, clamped)) return expandWord(text, clamped)

  // Otherwise walk back to the nearest preceding word character. Whitespace and
  // punctuation are both stepped over, so a caret in the gap between two words
  // takes the earlier one, and a caret after a sentence's final "." still finds
  // the last word. Predictable beats clever: a pin landing on the word you can
  // see immediately left of your cursor is never surprising.
  let probe = clamped - 1
  while (probe >= 0 && !isWordCharacterAt(text, probe)) probe--

  // No preceding word at all — empty text, or a caret sitting in leading
  // punctuation. Unanchorable; the caller should ask for a better target.
  return probe >= 0 ? expandWord(text, probe) : { start: clamped, end: clamped }
}

/**
 * Build an anchor for a range in the flat text.
 *
 * A collapsed range is snapped to its surrounding word. If the caret sits in
 * whitespace with no adjacent word, the anchor is returned with an empty quote —
 * which `resolveAnchor` reports as orphaned, and the UI should present as "pick
 * a spot on the text" rather than silently pinning to a meaningless position.
 */
export function createAnchor(text: string, start: number, end: number): TextAnchor {
  let from = Math.max(0, Math.min(start, text.length))
  let to = Math.max(0, Math.min(end, text.length))
  if (from > to) [from, to] = [to, from]

  if (from === to) {
    const snapped = snapToWord(text, from)
    from = snapped.start
    to = snapped.end
  }

  return {
    quote: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT_LENGTH), from),
    suffix: text.slice(to, to + CONTEXT_LENGTH),
    startOffset: from,
    endOffset: to,
  }
}
