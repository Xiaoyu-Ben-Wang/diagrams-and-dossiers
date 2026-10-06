// Only `width`, `editable` and `collapsed` are read today; the rest are parsed and stored
// so a row carrying them survives a round trip, awaiting the UI that reads them.

export const ARTICLE_WIDTHS = [480, 720, 960] as const
export type ArticleWidth = (typeof ARTICLE_WIDTHS)[number]

export const ARTICLE_TYPE_SCALES = ['small', 'normal', 'large'] as const
export type ArticleTypeScale = (typeof ARTICLE_TYPE_SCALES)[number]

export const ARTICLE_PAPERS = ['parchment', 'white', 'grey'] as const
export type ArticlePaper = (typeof ARTICLE_PAPERS)[number]

export interface ArticleOptions {
  /** The page's width in board px; a dragged value, not limited to `ARTICLE_WIDTHS`. */
  width: number
  typeScale: ArticleTypeScale
  paper: ArticlePaper
  titleBar: boolean
  editable: boolean
  acceptsPins: boolean
  collapsible: boolean
  collapsed: boolean
}

// 720 is the width the board was built around, and what a new page opens at.
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

// Not the draggable clamp: that lives in `ArticleSheet`, because clamping here would
// rewrite a stored width the clamp has since moved past.
function width(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback
}

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
