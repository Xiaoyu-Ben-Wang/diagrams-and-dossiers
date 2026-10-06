export interface CachedPosition {
  x: number;
  y: number;
  paperVersion: number;
}

export interface TextAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  /** Character offset into the article's flat text. A hint, not the truth. */
  startOffset: number;
  endOffset: number;
  cached?: CachedPosition;
}

export type Resolution =
  | { status: "exact"; start: number; end: number; confidence: 1 }
  | {
      status: "repaired";
      start: number;
      end: number;
      confidence: number;
      reason: RepairReason;
    }
  /** The quote is gone: fall back to `cached` and render faded rather than guessing. */
  | { status: "orphaned"; reason: OrphanReason };

export type RepairReason =
  "offset-shifted" | "windowed-search" | "global-search" | "fuzzy-context";

export type OrphanReason = "empty-quote" | "quote-not-found";
