/**
 * What an article can be configured to be.
 *
 * An article is a note with more to configure, so it gets more knobs — but only
 * knobs something reads. Each option below is consumed by the article renderer
 * or by the board's hit-testing; anything that would only sit in the type is
 * left out until the feature that needs it exists.
 *
 * Access (who may see it) is deliberately NOT here. It is a column on every
 * entity, not an article speciality — a note or an image can be DM-only too —
 * so it lives on `EntityBase` and is governed by `access/permissions`.
 *
 * The shape follows `theme/preferences.ts`: enumerated option sets as const
 * tuples, a typed interface, defaults, and a total parse so untyped input
 * (a stored blob, a network payload) can never reach state.
 */

export const ARTICLE_WIDTHS = [480, 720, 960] as const
export type ArticleWidth = (typeof ARTICLE_WIDTHS)[number]

export const ARTICLE_TYPE_SCALES = ['small', 'normal', 'large'] as const
export type ArticleTypeScale = (typeof ARTICLE_TYPE_SCALES)[number]

export const ARTICLE_PAPERS = ['parchment', 'white', 'grey'] as const
export type ArticlePaper = (typeof ARTICLE_PAPERS)[number]

export interface ArticleOptions {
  /** Presentation. */
  width: ArticleWidth
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

/** 720 is the width the board was built around; reflow maths depends on it. */
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
    width: pick(source.width, ARTICLE_WIDTHS, DEFAULT_ARTICLE_OPTIONS.width),
    typeScale: pick(source.typeScale, ARTICLE_TYPE_SCALES, DEFAULT_ARTICLE_OPTIONS.typeScale),
    paper: pick(source.paper, ARTICLE_PAPERS, DEFAULT_ARTICLE_OPTIONS.paper),
    titleBar: bool(source.titleBar, DEFAULT_ARTICLE_OPTIONS.titleBar),
    editable: bool(source.editable, DEFAULT_ARTICLE_OPTIONS.editable),
    acceptsPins: bool(source.acceptsPins, DEFAULT_ARTICLE_OPTIONS.acceptsPins),
    collapsible: bool(source.collapsible, DEFAULT_ARTICLE_OPTIONS.collapsible),
    collapsed: bool(source.collapsed, DEFAULT_ARTICLE_OPTIONS.collapsed),
  }
}
