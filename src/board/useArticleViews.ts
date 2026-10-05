/**
 * Turning what the board stores into what it paints.
 *
 * An entity is a description, not a position. A pin is a quote and a nudge; the
 * pixels only exist once that quote has been resolved against the article as it
 * is rendered *right now*, which needs three things that are not on the entity:
 * the article's flat text, the offset of its content box inside its paper, and
 * its measured footprint. With one page these were three pieces of state in
 * `App.tsx` — one projection, one inset, one rect. With a board that holds more
 * than one page they are three facts *per page*, and every one of them has to
 * be keyed by an article id or a pin resolves against the wrong sheet's words.
 *
 * So this is the measurement layer: it owns the DOM nodes each sheet hangs its
 * elements on, measures each paper, projects each article's rendered body, and
 * then resolves every pin against the article it actually names. It replaces a
 * `projectionRef` and a `paperRect` that could only ever describe one page.
 *
 * Two rules hold the shape together:
 *
 *  - **A view is keyed by article id, never by "the article".** Everything
 *    downstream — `EntityContext.articleToBoard`, `articleSize`, a tack's
 *    string endpoint — is handed an id and answers for that page.
 *
 *  - **The board position is not measured, it is read from the entity.** A
 *    paper's width and height are facts about layout and have to be measured;
 *    where the sheet *is* lives on the entity and is always current. Keeping
 *    the two apart is what stops a view from lagging a drag by a frame, which
 *    is what would happen if the mapping that places a tack went through
 *    measured state.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'

import {
  flatRangeToDomRange,
  projectDom,
  rangeToContainerRects,
  type DomProjection,
} from '../anchors/dom'
import { resolveAnchor } from '../anchors/resolve'
import { isAnchoredPin, type ArticleEntity, type PinEntity } from '../model/types'
import { px, type PinView } from './view'
import type { Point } from './yarn'

/**
 * The DOM nodes one article's sheet owns.
 *
 * Handed to the sheet rather than owned by it, because the effects that measure
 * them outlive any one render: a ref that is re-created when the sheet re-mounts
 * is a ref that measures nothing. The sheet fills these in with its own
 * elements; the registry here is what keeps them findable by article id.
 */
export interface ArticleNodes {
  paper: HTMLDivElement | null
  article: HTMLDivElement | null
}

/**
 * What one article measures to right now.
 *
 * `inset` and `size` are measured; the article's *position* is not here, because
 * it belongs to the entity and is never stale. See the note at the top.
 */
export interface ArticleView {
  /**
   * The offset from the paper's top-left corner to the article inside it.
   *
   * Anchor rects are measured against the article and are therefore in the
   * article's own space, while the entity's `board` is the *paper's* corner.
   * Anything crossing between the two has to add this. Leaving it out put every
   * anchored tack 48x40 board px from where it was drawn — further than
   * `SNAP_RADIUS`, so no string could ever be tied to a pin.
   */
  inset: Point
  /** The paper's footprint in board px, which is its own size and not the text's. */
  size: { width: number; height: number }
  /** The flat-text projection of the article as it is currently rendered. */
  projection: DomProjection
}

export interface ArticleViews {
  /**
   * The nodes for one article's sheet.
   *
   * Stable per id, so a sheet can hold the object across renders and hang refs
   * on it. Asking for an id that has never been seen mints the entry, which is
   * what lets the sheet be the thing that declares "I am on the board".
   */
  nodesFor(articleId: string): ArticleNodes
  /** The live node registry, for callers that need an element by article id. */
  nodes(): ReadonlyMap<string, ArticleNodes>
  /** What each article has measured to, by article id. */
  views: ReadonlyMap<string, ArticleView>
}

/** Whether two lengths are the same length, to the pixel a browser reports. */
function sameSize(a: { width: number; height: number }, b: { width: number; height: number }) {
  return a.width === b.width && a.height === b.height
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y
}

/**
 * The stable identity of everything about an article that changes its layout.
 *
 * A string rather than an array of entities, because the effect that re-measures
 * has to re-run when the *rendered body* changes and must not re-run when the
 * page is merely dragged — and `entities` is a new array for both. Moving a
 * sheet does not change its text, its width or whether it is rolled up, so it
 * does not appear here, and a drag costs no measurement at all.
 */
function layoutSignature(articles: readonly ArticleEntity[]): string {
  return articles
    .map((a) => [a.id, a.options.width, a.options.collapsed, a.bodyMd].join('\u0000'))
    .join('\u0001')
}

export function useArticleViews(
  articles: readonly ArticleEntity[],
  fontsLoaded: boolean,
): ArticleViews {
  const [views, setViews] = useState<ReadonlyMap<string, ArticleView>>(() => new Map())
  const nodesRef = useRef(new Map<string, ArticleNodes>())
  /** The latest views, for the observer callback, which is not re-created. */
  const viewsRef = useRef(views)
  viewsRef.current = views
  const articlesRef = useRef(articles)
  articlesRef.current = articles
  const observerRef = useRef<ResizeObserver | null>(null)

  const nodesFor = useCallback((articleId: string): ArticleNodes => {
    const existing = nodesRef.current.get(articleId)
    if (existing) return existing
    const created: ArticleNodes = { paper: null, article: null }
    nodesRef.current.set(articleId, created)
    return created
  }, [])

  const nodes = useCallback(() => nodesRef.current as ReadonlyMap<string, ArticleNodes>, [])

  /**
   * Measure and project every article that is on the board.
   *
   * `force` is the difference between the two reasons this runs. A layout
   * signature change means the article's own content or width moved, so every
   * projection is rebuilt. A resize callback means the browser re-laid something
   * out — most often the window crossing the padding breakpoint, which reflows
   * every page at once — and there the projections only need rebuilding for the
   * pages whose box actually changed. Rebuilding them all on every observer
   * callback would mint a new projection several times a second for a window
   * being dragged, and every pin on every page re-resolves with it.
   */
  /**
   * The element each view's projection was built from.
   *
   * Kept beside the views rather than in them, because it is not a measurement —
   * it is the thing that says whether a measurement is still about the DOM in
   * front of us. React re-creates the article's nodes whenever its body is
   * re-rendered, and a projection holds *references* to the old ones; comparing
   * the element is what stops a re-expanded page resolving every pin against
   * text nodes that are no longer in the document.
   */
  const projectedRef = useRef(new Map<string, HTMLDivElement>())

  const measure = useCallback((force: boolean) => {
    const previous = viewsRef.current
    const next = new Map<string, ArticleView>()
    let changed = force

    for (const article of articlesRef.current) {
      const entry = nodesRef.current.get(article.id)
      const paper = entry?.paper
      const element = entry?.article
      const before = previous.get(article.id)

      // Rolled up, or not yet committed. A collapsed page renders no article at
      // all, so there is nothing to project — and its last measurement is kept
      // rather than dropped, because a string tied to the page still has to end
      // at its tab and the page's own pins are still its pins while it is shut.
      if (!paper || !element) {
        if (before) next.set(article.id, before)
        continue
      }

      const style = getComputedStyle(paper)
      // Read rather than assumed: the padding is responsive (px-9/py-8 flips to
      // sm:px-12/sm:py-10), so a hardcoded 48x40 would be wrong below the
      // breakpoint.
      const inset = {
        x: px(style.paddingLeft) + px(style.borderLeftWidth),
        y: px(style.paddingTop) + px(style.borderTopWidth),
      }
      const size = { width: paper.offsetWidth, height: paper.offsetHeight }

      if (
        !force &&
        before &&
        projectedRef.current.get(article.id) === element &&
        sameSize(before.size, size) &&
        samePoint(before.inset, inset)
      ) {
        next.set(article.id, before)
        continue
      }

      changed = true
      projectedRef.current.set(article.id, element)
      next.set(article.id, { inset, size, projection: projectDom(element) })
    }

    // Also a change: a page left the board. Its view would otherwise linger and
    // go on answering `articleSize` for an article nothing renders.
    if (changed || next.size !== previous.size) setViews(next)
  }, [])

  const measureRef = useRef(measure)
  measureRef.current = measure

  const layout = layoutSignature(articles)

  useLayoutEffect(() => {
    if (!fontsLoaded) return

    // Created here rather than in an effect of its own, because this runs before
    // that one would and has to be able to observe the papers it has just found.
    // One observer for every page: they are told apart by which element the
    // callback's entry names, and there is nothing per-page left to hold.
    if (!observerRef.current && typeof ResizeObserver !== 'undefined') {
      observerRef.current = new ResizeObserver(() => measureRef.current(false))
    }

    const observer = observerRef.current
    observer?.disconnect()
    for (const article of articlesRef.current) {
      const paper = nodesRef.current.get(article.id)?.paper
      if (paper) observer?.observe(paper)
    }

    measureRef.current(true)
  }, [layout, fontsLoaded])

  // Disconnected on the way out, not on every re-measure: re-registering the
  // observed elements happens above, and tearing the observer down each time
  // would lose the callbacks of a resize already in flight.
  useLayoutEffect(() => () => observerRef.current?.disconnect(), [])

  return useMemo(() => ({ nodesFor, nodes, views }), [nodesFor, nodes, views])
}

/**
 * Every pin, resolved against the article it names.
 *
 * The one thing this must never do is fall back to "the article" — a pin whose
 * page is gone is orphaned, and a pin whose quote has moved is repaired; a pin
 * measured against a neighbouring page's text is neither, and it is drawn on
 * words it has nothing to do with. So the article id decides the projection,
 * and the article's absence decides the orphan.
 *
 * `zoomRef` is read rather than taken as a dependency: the rects come out in the
 * article's own space once the scale is divided out, so they do not depend on
 * which zoom was in force when they were measured — and re-resolving every
 * anchor on every frame of a zoom would be work for nothing.
 */
export function usePinViews(
  placed: readonly PinEntity[],
  articlesById: ReadonlyMap<string, ArticleEntity>,
  articleViews: ArticleViews,
  zoomRef: RefObject<number>,
): PinView[] {
  const { views, nodes } = articleViews

  return useMemo(() => {
    const resolved: PinView[] = []

    for (const item of placed) {
      const base = {
        id: item.id,
        body: item.bodyMd,
        dateLabel: item.dateLabel ?? '',
        nudge: item.nudge,
      }

      // A pin stuck into the board has no quote to resolve; its position is
      // simply its position.
      if (!isAnchoredPin(item)) {
        resolved.push({
          ...base,
          articleId: null,
          quote: '',
          status: 'free',
          detail: 'loose on the board',
          rect: null,
          board: item.board,
        })
        continue
      }

      const article = articlesById.get(item.articleId)
      const view = views.get(item.articleId)
      const element = nodes().get(item.articleId)?.article ?? null

      // The page it was pinned to is not on the board at all. Reported rather
      // than hidden: the pin still holds someone's writing, and a note that
      // vanishes silently is worse than one that admits it has lost its page.
      if (!article) {
        resolved.push({
          ...base,
          articleId: item.articleId,
          quote: item.anchor.quote,
          status: 'orphaned',
          detail: 'the page it was pinned to is gone',
          rect: null,
          board: null,
        })
        continue
      }

      // The page is here but has not been measured yet — the first frame after
      // a reload, or a sheet that has only just been created. Left out for that
      // frame rather than orphaned: "not yet" is not "never", and a tack that
      // flashed red on every load would teach people to ignore the colour.
      if (!view || !element) continue

      const result = resolveAnchor(view.projection.flat.text, item.anchor)

      if (result.status === 'orphaned') {
        resolved.push({
          ...base,
          articleId: item.articleId,
          quote: item.anchor.quote,
          status: 'orphaned',
          detail:
            result.reason === 'empty-quote'
              ? 'no text to anchor to'
              : 'the words it was pinned to are gone',
          rect: null,
          board: null,
        })
        continue
      }

      const range = flatRangeToDomRange(view.projection, result.start, result.end)
      const rects = range ? rangeToContainerRects(range, element, zoomRef.current || 1) : []
      const first = rects[0] ?? null

      resolved.push({
        ...base,
        articleId: item.articleId,
        quote: item.anchor.quote,
        status: result.status === 'exact' ? 'exact' : 'repaired',
        detail:
          result.status === 'exact'
            ? 'unchanged'
            : `${result.reason.replace('-', ' ')} · ${Math.round(result.confidence * 100)}% context match`,
        rect: first,
        board: null,
      })
    }

    return resolved
  }, [placed, articlesById, articleViews, views, nodes, zoomRef])
}
