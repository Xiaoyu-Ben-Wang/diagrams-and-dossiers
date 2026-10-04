/**
 * The anchor model, modelled on the W3C Web Annotation Data Model's
 * TextQuoteSelector + TextPositionSelector combination (the approach Hypothesis
 * uses), with a cached pixel position as a last resort.
 *
 * Three selectors, tried in order of decreasing confidence:
 *   quote          — the actual anchored text, the robust one
 *   prefix/suffix  — context that disambiguates repeated quotes
 *   startOffset    — a positional hint that usually makes resolution O(1)
 *   cached         — where it was last seen, for pins whose text has vanished
 */

export interface CachedPosition {
  x: number
  y: number
  /** The article revision this position was measured against. */
  paperVersion: number
}

export interface TextAnchor {
  /** The anchored text. */
  quote: string
  /** Up to CONTEXT_LENGTH characters immediately before the quote. */
  prefix: string
  /** Up to CONTEXT_LENGTH characters immediately after the quote. */
  suffix: string
  /** Character offset into the article's flat text. A hint, not the truth. */
  startOffset: number
  endOffset: number
  cached?: CachedPosition
}

export type Resolution =
  /** The quote sat exactly where the offset said. Nothing had moved. */
  | { status: 'exact'; start: number; end: number; confidence: 1 }
  /**
   * The offset was stale but the quote was found and its surroundings agreed.
   * The pin is on the right words; the article simply moved around it.
   */
  | { status: 'repaired'; start: number; end: number; confidence: number; reason: RepairReason }
  /**
   * The quote could not be found. The caller should fall back to `cached` and
   * render the pin faded — "the trail is cold" — rather than guessing.
   */
  | { status: 'orphaned'; reason: OrphanReason }

export type RepairReason =
  | 'offset-shifted'
  | 'windowed-search'
  | 'global-search'
  | 'fuzzy-context'

export type OrphanReason = 'empty-quote' | 'quote-not-found'
