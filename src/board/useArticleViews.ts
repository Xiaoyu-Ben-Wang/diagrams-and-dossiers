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

export interface ArticleNodes {
  paper: HTMLDivElement | null
  article: HTMLDivElement | null
}

export interface ArticleView {
  /** Paper corner to article corner; omitting it puts every anchored tack 48x40 board px off. */
  inset: Point
  size: { width: number; height: number }
  projection: DomProjection
}

export interface ArticleViews {
  /** Stable per id, so a sheet can hold the object across renders. */
  nodesFor(articleId: string): ArticleNodes
  nodes(): ReadonlyMap<string, ArticleNodes>
  views: ReadonlyMap<string, ArticleView>
}

function sameSize(a: { width: number; height: number }, b: { width: number; height: number }) {
  return a.width === b.width && a.height === b.height
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y
}

/** Changes with anything that alters layout, and NOT with a drag, so a drag costs no measurement. */
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
   * The element each projection was built from; without the comparison a re-rendered page keeps resolving against removed nodes.
   * `force` rebuilds every projection; otherwise only pages whose box changed.
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

      // Collapsed or uncommitted: keep the last measurement, so a string to the tab still lands.
      if (!paper || !element) {
        if (before) next.set(article.id, before)
        continue
      }

      const style = getComputedStyle(paper)
      // Padding is responsive (px-9/py-8 → sm:px-12/sm:py-10), so it must be read, not hardcoded.
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

    // A page that left the board must also count as a change, or its stale view lingers.
    if (changed || next.size !== previous.size) setViews(next)
  }, [])

  const measureRef = useRef(measure)
  measureRef.current = measure

  const layout = layoutSignature(articles)

  useLayoutEffect(() => {
    if (!fontsLoaded) return

    // One observer for every page; the callback tells them apart by element.
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

  // Disconnect only on unmount: tearing down each measure would drop an in-flight resize.
  useLayoutEffect(() => () => observerRef.current?.disconnect(), [])

  return useMemo(() => ({ nodesFor, nodes, views }), [nodesFor, nodes, views])
}

/** Never falls back to "the article"; `zoomRef` is read, not a dependency, so a zoom does not re-resolve. */
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

      // Not yet measured (first frame after reload): skip, do not orphan — "not yet" is not "never".
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
