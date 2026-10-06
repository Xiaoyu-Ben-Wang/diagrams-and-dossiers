/**
 * Fallbacks, cheapest first: exact offset, windowed search, global
 * context-scored search, then orphaned (which never guesses).
 */

import type { RepairReason, Resolution, TextAnchor } from "./types";

/**
 * How far from the stored offset a windowed match may sit: larger than a
 * paragraph rewrite, smaller than a long article's repeated phrase.
 */
export const SEARCH_WINDOW = 2000;

/** At or below this context score the repair is reported as provisional. */
export const LOW_CONFIDENCE = 0.5;

function findAllOccurrences(text: string, quote: string): number[] {
  const found: number[] = [];
  if (!quote) return found;
  let index = text.indexOf(quote);
  while (index !== -1) {
    found.push(index);
    index = text.indexOf(quote, index + 1);
  }
  return found;
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/** How well the text surrounding an occurrence agrees with the anchor's context, 1 being exact. */
function scoreOccurrence(
  text: string,
  index: number,
  quote: string,
  prefix: string,
  suffix: string,
): number {
  const before = text.slice(Math.max(0, index - prefix.length), index);
  const afterStart = index + quote.length;
  const after = text.slice(afterStart, afterStart + suffix.length);

  const prefixScore =
    prefix.length > 0 ? commonSuffixLength(before, prefix) / prefix.length : 1;
  const suffixScore =
    suffix.length > 0 ? commonPrefixLength(after, suffix) / suffix.length : 1;

  return (prefixScore + suffixScore) / 2;
}

interface Candidate {
  index: number;
  score: number;
  distance: number;
}

function pickBest(
  text: string,
  occurrences: number[],
  anchor: TextAnchor,
  storedOffset: number,
): Candidate {
  let best: Candidate | null = null;

  for (const index of occurrences) {
    const candidate: Candidate = {
      index,
      score: scoreOccurrence(
        text,
        index,
        anchor.quote,
        anchor.prefix,
        anchor.suffix,
      ),
      distance: Math.abs(index - storedOffset),
    };

    if (
      best === null ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.distance < best.distance)
    ) {
      best = candidate;
    }
  }

  // `occurrences` is never empty at the call sites.
  return best as Candidate;
}

/** `text` must be the flat text the anchor was created against: see projection.ts. */
export function resolveAnchor(text: string, anchor: TextAnchor): Resolution {
  const { quote, startOffset } = anchor;

  if (!quote) return { status: "orphaned", reason: "empty-quote" };

  if (text.startsWith(quote, startOffset)) {
    return {
      status: "exact",
      start: startOffset,
      end: startOffset + quote.length,
      confidence: 1,
    };
  }

  const occurrences = findAllOccurrences(text, quote);
  if (occurrences.length === 0) {
    return { status: "orphaned", reason: "quote-not-found" };
  }

  const nearby = occurrences.filter(
    (index) => Math.abs(index - startOffset) <= SEARCH_WINDOW,
  );
  const usingWindow = nearby.length > 0;
  const best = pickBest(
    text,
    usingWindow ? nearby : occurrences,
    anchor,
    startOffset,
  );

  const reason: RepairReason =
    best.score < LOW_CONFIDENCE
      ? "fuzzy-context"
      : usingWindow
        ? "windowed-search"
        : "global-search";

  return {
    status: "repaired",
    start: best.index,
    end: best.index + quote.length,
    confidence: best.score,
    reason,
  };
}

export function resolveAnchorRange(
  text: string,
  anchor: TextAnchor,
): { start: number; end: number; exact: boolean } | null {
  const result = resolveAnchor(text, anchor);
  if (result.status === "orphaned") return null;
  return {
    start: result.start,
    end: result.end,
    exact: result.status === "exact",
  };
}
