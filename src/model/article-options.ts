/**
 * What an article can be configured to be.
 *
 * An article is a note with more to configure, so it gets more knobs — but only
 * knobs something reads.
 *
 * Three are read today: `width`, by the sheet and by its resize; `editable`, by
 * `access/permissions` and the descriptor; `collapsed`, by the roll-up. Four are
 * not, and it would be a mistake to read this interface as though they were:
 * `typeScale` and `paper` are presentation the sheet hardcodes, `titleBar` is
 * the tab that is always drawn, `collapsible` is the roll-up that is always
 * offered, and `acceptsPins` is the anchoring that is always allowed. They are
 * parsed and stored so that a row carrying them survives a round trip, and
 * wiring them is a presentation feature rather than a piece of missing
 * plumbing — see the queue archive. Anything new here should arrive with the thing
 * that reads it.
 *
 * Access (who may see it) is deliberately NOT here. It is a column on every
 * entity, not an article speciality — a note or an image can be DM-only too —
 * so it lives on `EntityBase` and is governed by `access/permissions`.
 *
 * The shape follows `theme/preferences.ts`: enumerated option sets as const
 * tuples, a typed interface, defaults, and a total parse so untyped input
 * (a stored blob, a network payload) can never reach state.
 */

/**
 * The widths a page is opened at, offered as presets.
 *
 * Presets rather than a closed set, which is what they used to be. A page is
 * resized by dragging its edge and the value that comes back is whatever the
 * pointer asked for — a union of three numbers could not hold it, so every
 * resize would have had to snap to one of them. What the page may be dragged
 * between is in `board/tuning.ts`, because that is a fact about reading a
 * column of text on this board rather than about one article's configuration.
 */
export const ARTICLE_WIDTHS = [480, 720, 960] as const
export type ArticleWidth = (typeof ARTICLE_WIDTHS)[number]

export const ARTICLE_TYPE_SCALES = ['small', 'normal', 'large'] as const
export type ArticleTypeScale = (typeof ARTICLE_TYPE_SCALES)[number]

export const ARTICLE_PAPERS = ['parchment', 'white', 'grey'] as const
export type ArticlePaper = (typeof ARTICLE_PAPERS)[number]

export interface ArticleOptions {
  /** Presentation. */
  /**
   * The page's width in board px.
   *
   * Not an `ArticleWidth`: the reader drags the edge and this is what the drag
   * produced. `ARTICLE_WIDTHS` are what a menu would offer, and
   * `PAPER_MIN_WIDTH`/`PAPER_MAX_WIDTH` are the clamp.
   */
  width: number
  typeScale: ArticleTypeScale
  paper: ArticlePaper
  /** Show the brass tab with the title. Off reads as an untitled handout. */
  titleBar: boolean
  /** Behaviour. */
  /** Whether the body can be edited in place. */
  editable: boolean
  /** Whether pins may be anchored into its text. */
  acceptsPins: boolean
  /** Whether it can be rolled up to a labelled strip on the board. */
  collapsible: boolean
  collapsed: boolean
}

/**
 * 720 is the width the board was built around, and the width a page opens at.
 *
 * It is a default now rather than a constant: each page carries its own, and
 * this is only what a new one is given before anyone has dragged its edge.
 */
export const DEFAULT_ARTICLE_OPTIONS: ArticleOptions = {
  width: 720,
  typeScale: 'normal',
  paper: 'parchment',
  titleBar: true,
  editable: true,
  acceptsPins: true,
  collapsible: false,
  collapsed: false,
}

function pick<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * A dragged width, coerced.
 *
 * Deliberately not `pick` from a tuple. The width is whatever a drag produced,
 * so the test is "is this a number a page could have" rather than membership of
 * a set: a zero, a negative or a NaN is not one, and falls back to the default.
 *
 * The clamp to what is draggable is not applied here. It lives with the drag,
 * in `ArticleSheet`, which is the only place that knows the pointer's answer is
 * bounded by how wide a column of text stays readable — and clamping on the way
 * *in* would silently rewrite a page that was stored at a width the clamp has
 * since moved past.
 */
function width(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback
}

/**
 * Coerce anything into valid options.
 *
 * Total by construction: every field falls back independently, so one bad value
 * cannot cost the rest of the configuration. This is the same contract as
 * `parsePreferences`, and it is what makes it safe to hand this a row from the
 * database or a blob from storage without checking it first.
 */
export function parseArticleOptions(raw: unknown): ArticleOptions {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    width: width(source.width, DEFAULT_ARTICLE_OPTIONS.width),
    typeScale: pick(source.typeScale, ARTICLE_TYPE_SCALES, DEFAULT_ARTICLE_OPTIONS.typeScale),
    paper: pick(source.paper, ARTICLE_PAPERS, DEFAULT_ARTICLE_OPTIONS.paper),
    titleBar: bool(source.titleBar, DEFAULT_ARTICLE_OPTIONS.titleBar),
    editable: bool(source.editable, DEFAULT_ARTICLE_OPTIONS.editable),
    acceptsPins: bool(source.acceptsPins, DEFAULT_ARTICLE_OPTIONS.acceptsPins),
    collapsible: bool(source.collapsible, DEFAULT_ARTICLE_OPTIONS.collapsible),
    collapsed: bool(source.collapsed, DEFAULT_ARTICLE_OPTIONS.collapsed),
  }
}
