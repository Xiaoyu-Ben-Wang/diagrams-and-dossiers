/**
 * Resolving an anchor back to a position in an article.
 *
 * The ladder, cheapest first:
 *
 *   1. Exact      — the quote still sits where the offset said. O(1), and this
 *                   is the common case: most edits don't move most pins.
 *   2. Windowed   — search near the stored offset. Catches the everyday case of
 *                   a paragraph being edited above the pin, which shifts every
 *                   offset below it by the length of the edit.
 *   3. Global     — search the whole article and score candidates by how well
 *                   their surrounding context matches. Handles text that moved a
 *                   long way, and disambiguates repeated phrases.
 *   4. Orphaned   — the quote is gone. Deliberately does NOT guess: a pin that
 *                   silently lands on the wrong sentence is worse than one that
 *                   admits it's lost, because nobody notices the silent one.
 *
 * Resolution is pure and synchronous — well under a millisecond for an
 * article-sized document — so callers can re-run it freely on edit and resize.
 */

import type { RepairReason, Resolution, TextAnchor } from './types'

/**
 * How far from the stored offset a "windowed" match may sit.
 * Comfortably larger than a paragraph rewrite, small enough that a repeated
 * phrase elsewhere in a long article can't win by accident.
 */
export const SEARCH_WINDOW = 2000

/**
 * Below this, the surrounding context disagreed enough that we report
 * 'fuzzy-context' — the caller may still use the position, but it should treat
 * it as provisional rather than certain.
 */
export const LOW_CONFIDENCE = 0.5

/** Every index at which `quote` occurs in `text`. */
function findAllOccurrences(text: string, quote: string): number[] {
  const found: number[] = []
  if (!quote) return found
  let index = text.indexOf(quote)
  while (index !== -1) {
    found.push(index)
    index = text.indexOf(quote, index + 1)
  }
  return found
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a[i] === b[i]) i++
  return i
}

function commonSuffixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}

/**
 * How well the text surrounding an occurrence agrees with the anchor's
 * recorded context. 1 means every character of prefix and suffix matched.
 *
 * Both sides are weighted equally. Prefix alone would be fooled by a moved
 * sentence whose opening words happen to repeat; suffix alone by the reverse.
 */
function scoreOccurrence(
  text: string,
  index: number,
  quote: string,
  prefix: string,
  suffix: string,
): number {
  const before = text.slice(Math.max(0, index - prefix.length), index)
  const afterStart = index + quote.length
  const after = text.slice(afterStart, afterStart + suffix.length)

  const prefixScore = prefix.length > 0 ? commonSuffixLength(before, prefix) / prefix.length : 1
  const suffixScore = suffix.length > 0 ? commonPrefixLength(after, suffix) / suffix.length : 1

  return (prefixScore + suffixScore) / 2
}

interface Candidate {
  index: number
  score: number
  distance: number
}

function pickBest(
  text: string,
  occurrences: number[],
  anchor: TextAnchor,
  storedOffset: number,
): Candidate {
  let best: Candidate | null = null

  for (const index of occurrences) {
    const candidate: Candidate = {
      index,
      score: scoreOccurrence(text, index, anchor.quote, anchor.prefix, anchor.suffix),
      distance: Math.abs(index - storedOffset),
    }

    // Higher context agreement wins. On a tie, the closer candidate wins —
    // an edit that moved a pin is far more likely to have nudged it than to
    // have teleported it across the article.
    if (
      best === null ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.distance < best.distance)
    ) {
      best = candidate
    }
  }

  // `occurrences` is never empty at the call sites.
  return best as Candidate
}

/**
 * Resolve an anchor against an article's current flat text.
 *
 * `text` must be the same flat text the anchor was created against — see
 * `projection.ts` for why that's the single shared definition of an offset.
 */
export function resolveAnchor(text: string, anchor: TextAnchor): Resolution {
  // prefix/suffix are read by pickBest via the anchor itself.
  const { quote, startOffset } = anchor

  if (!quote) return { status: 'orphaned', reason: 'empty-quote' }

  // 1. Exact. `startsWith` with a position avoids materializing a slice.
  if (text.startsWith(quote, startOffset)) {
    return {
      status: 'exact',
      start: startOffset,
      end: startOffset + quote.length,
      confidence: 1,
    }
  }

  const occurrences = findAllOccurrences(text, quote)
  if (occurrences.length === 0) {
    return { status: 'orphaned', reason: 'quote-not-found' }
  }

  // 2. Windowed.
  const nearby = occurrences.filter((index) => Math.abs(index - startOffset) <= SEARCH_WINDOW)
  const usingWindow = nearby.length > 0
  const best = pickBest(text, usingWindow ? nearby : occurrences, anchor, startOffset)

  // If no candidate is inside the window we searched globally; if the context
  // still disagreed, say so rather than implying a confident repair.
  const reason: RepairReason =
    best.score < LOW_CONFIDENCE
      ? 'fuzzy-context'
      : usingWindow
        ? 'windowed-search'
        : 'global-search'

  return {
    status: 'repaired',
    start: best.index,
    end: best.index + quote.length,
    confidence: best.score,
    reason,
  }
}

/**
 * Convenience wrapper for callers that only need the range.
 * Returns null when the pin is orphaned and should fall back to its cached
 * pixel position (or be presented for re-attachment).
 */
export function resolveAnchorRange(
  text: string,
  anchor: TextAnchor,
): { start: number; end: number; exact: boolean } | null {
  const result = resolveAnchor(text, anchor)
  if (result.status === 'orphaned') return null
  return { start: result.start, end: result.end, exact: result.status === 'exact' }
}
