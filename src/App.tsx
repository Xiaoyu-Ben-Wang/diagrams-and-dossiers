import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { createAnchor } from './anchors/create'
import {
  domRangeToFlatRange,
  flatRangeToDomRange,
  projectDom,
  rangeToContainerRects,
  type AnchorRect,
  type DomProjection,
} from './anchors/dom'
import { resolveAnchor } from './anchors/resolve'
import type { TextAnchor } from './anchors/types'
import { TopBar } from './app/TopBar'
import { useRoute } from './app/router'
import { BoardCanvas, type BoardContextTarget } from './board/BoardCanvas'
import { useBoardDrag } from './board/useBoardDrag'
import { ContextMenu, type ContextMenuEntry } from './board/ContextMenu'
import { GridLayer } from './board/GridLayer'
import { PaperEditor } from './board/PaperEditor'
import { PinEditor } from './board/PinEditor'
import { TimelineRibbon } from './board/TimelineRibbon'
import { fitBounds, IDENTITY_CAMERA, screenToBoard, type Camera, type Rect } from './board/camera'
import { activeAt, buildTimeline, clusterTimeline, type TimelineEntry } from './board/timeline'
import {
  colorForPair,
  createSpring,
  stepSpring,
  yarnPath,
  YARN_HEX,
  type Point,
  type YarnColor,
} from './board/yarn'
import { seedFromKey, yarnStrands } from './board/yarn-style'
import { PREFERENCES_PANEL_ID, PreferencesPanel } from './theme/PreferencesPanel'
import { usePreferences } from './theme/preferences'
import { WikiView } from './wiki/WikiView'
import { linkifyHtml, wikiLinkFromEvent } from './wiki/linkify'
import { slugify } from './wiki/links'

const INITIAL_MARKDOWN = `# The Drowned Bell

**Session 12** — 3rd of Eleint, 1492 DR

The party returned to [[Saltmarsh]] with the bell they pulled from the
[[The Sea Ghost|Sea Ghost]]. [[Molgar the Pale]] paid the ferryman in
silver and said nothing at all about the water.

## What we know

- The bell rings at low tide, though no hand touches it
- Three dockworkers have gone missing since the harvest festival
- The harbormaster's ledger lists a fourth name, scratched out

> "The tide keeps what it takes," the ferryman said.

The [[The Black Coin|Black Coin]] came up twice: once from the ferryman,
and once in the ledger, in a hand nobody recognised.
`

const ARTICLE_TITLE = 'The Drowned Bell'

const DEMO_ARTICLES = [
  { slug: 'saltmarsh', title: 'Saltmarsh' },
  { slug: 'molgar-the-pale', title: 'Molgar the Pale' },
  { slug: 'the-black-coin', title: 'The Black Coin' },
  { slug: 'the-drowned-bell', title: 'The Drowned Bell' },
]

const SLACK = 0.18
const SNAP_RADIUS = 34
const PAPER_WIDTH = 720

const CAMPAIGN_EPOCH = Date.UTC(2026, 0, 10)
const SESSION_GAP_MS = 14 * 24 * 60 * 60 * 1000
const FIRST_SESSION = 12

/** Post-it colours, keyed to the yarn palette so the board reads as one set. */
const POST_IT_COLORS = ['#e8d9a8', '#e6c9a8', '#d9c2b0', '#cfd6bd'] as const

interface PinView {
  id: string
  quote: string
  body: string
  /** 'free' is a pin stuck straight into the board rather than into text. */
  status: 'exact' | 'repaired' | 'orphaned' | 'free'
  detail: string
  /** Position within the paper, for a pin anchored to text. */
  rect: AnchorRect | null
  /** Position in board space, for a pin stuck into the board itself. */
  board: Point | null
}

interface PlacedPin {
  id: string
  /** Set for a pin anchored to a quote. Null for a free board pin. */
  anchor: TextAnchor | null
  /** Set for a free board pin. Null for an anchored one. */
  board: Point | null
  body: string
  occurredAt: number
  dateLabel: string
}

/** A free-floating note. Unlike a pin, its position is its own, in board space. */
interface PostIt {
  id: string
  x: number
  y: number
  body: string
  color: string
  dateLabel: string
}

interface StringView {
  id: string
  from: string
  to: string
  color: YarnColor
}

function caretRangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }

  if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y)

  const position = doc.caretPositionFromPoint?.(x, y)
  if (!position) return null
  const range = document.createRange()
  range.setStart(position.offsetNode, position.offset)
  range.collapse(true)
  return range
}

function tackPoint(rect: AnchorRect): Point {
  return { x: rect.x + rect.width - 6 + 7, y: rect.y - 5 + 7 }
}

/**
 * Where a pin's tack sits in BOARD space.
 *
 * Anchored pins are measured inside the paper, so they need the paper's own
 * offset added; free pins already are board coordinates. Returning null for an
 * orphaned pin keeps a string to something that no longer exists out of the
 * render rather than drawing it to the origin.
 */
function pinPoint(pin: PinView, paper: Point): Point | null {
  if (pin.rect) return { x: paper.x + tackPoint(pin.rect).x, y: paper.y + tackPoint(pin.rect).y }
  if (pin.board) return pin.board
  return null
}

export function App() {
  const { route, navigate } = useRoute()
  const preferences = usePreferences()

  // Board state lives above the route switch on purpose: navigating to /wiki
  // and back must not wipe the board.
  const [source, setSource] = useState(INITIAL_MARKDOWN)
  const [placed, setPlaced] = useState<PlacedPin[]>([])
  const [postIts, setPostIts] = useState<PostIt[]>([])
  const [pins, setPins] = useState<PinView[]>([])
  const [strings, setStrings] = useState<StringView[]>([])
  const [dragFrom, setDragFrom] = useState<string | null>(null)
  const [fontsLoaded, setFontsLoaded] = useState(() => !globalThis.document?.fonts)
  const [cursor, setCursor] = useState(CAMPAIGN_EPOCH)
  const [playing, setPlaying] = useState(false)
  const [camera, setCamera] = useState<Camera>(IDENTITY_CAMERA)
  const [editingPin, setEditingPin] = useState<{ id: string; x: number; y: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<
    (BoardContextTarget & { board: Point }) | null
  >(null)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [paperRect, setPaperRect] = useState<Rect | null>(null)
  /** The editor only appears once a document has been selected. */
  const [documentSelected, setDocumentSelected] = useState(false)
  /** Where the article sits in board space. Its own position, like any object. */
  const [paperPos, setPaperPos] = useState<Point>({ x: 0, y: 0 })
  const paperPosRef = useRef(paperPos)
  paperPosRef.current = paperPos

  const articleRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const livePathRef = useRef<SVGPathElement>(null)
  const projectionRef = useRef<DomProjection | null>(null)

  const springRef = useRef({ x: createSpring(0), y: createSpring(0) })
  const targetRef = useRef<Point>({ x: 0, y: 0 })
  const originRef = useRef<Point | null>(null)
  const frameRef = useRef<number>(0)
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  const resolveWikiTarget = useCallback((target: string) => {
    const wanted = slugify(target)
    return (
      DEMO_ARTICLES.find(
        (article) =>
          article.slug === wanted || article.title.toLowerCase() === target.toLowerCase(),
      )?.slug ?? null
    )
  }, [])

  // Sanitize, then linkify — both before the article reaches the DOM.
  // Linkifying after the article was projected would shift every offset below a
  // link by the width of the brackets it removes.
  const html = useMemo(
    () =>
      linkifyHtml(DOMPurify.sanitize(marked.parse(source, { async: false })), {
        resolve: resolveWikiTarget,
      }),
    [source, resolveWikiTarget],
  )

  useEffect(() => {
    if (!document.fonts) return
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (!cancelled) setFontsLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useLayoutEffect(() => {
    const paper = paperRef.current
    if (!paper || !fontsLoaded) return

    const measure = (): void => {
      const width = paper.offsetWidth
      const height = paper.offsetHeight
      // In board space, and offset by wherever the paper has been dragged to —
      // otherwise "zoom to fit" frames where the paper used to be.
      if (width > 0 && height > 0) {
        setPaperRect({ x: paperPosRef.current.x, y: paperPosRef.current.y, width, height })
      }
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(paper)
    return () => observer.disconnect()
  }, [fontsLoaded, paperPos])

  useLayoutEffect(() => {
    const element = articleRef.current
    if (!element || !fontsLoaded) return

    const projection = projectDom(element)
    projectionRef.current = projection

    setPins(
      placed.map((item) => {
        const base = { id: item.id, quote: item.anchor?.quote ?? '', body: item.body }

        // A pin stuck into the board has no quote to resolve; its position is
        // simply its position.
        if (!item.anchor) {
          return {
            ...base,
            status: 'free' as const,
            detail: 'loose on the board',
            rect: null,
            board: item.board,
          }
        }

        const result = resolveAnchor(projection.flat.text, item.anchor)

        if (result.status === 'orphaned') {
          return {
            ...base,
            status: 'orphaned' as const,
            detail:
              result.reason === 'empty-quote'
                ? 'no text to anchor to'
                : 'the words it was pinned to are gone',
            rect: null,
            board: null,
          }
        }

        const range = flatRangeToDomRange(projection, result.start, result.end)
        const rects = range ? rangeToContainerRects(range, element) : []
        const first = rects[0] ?? null

        if (result.status === 'exact') {
          return {
            ...base,
            status: 'exact' as const,
            detail: 'unchanged',
            rect: first,
            board: null,
          }
        }

        return {
          ...base,
          status: 'repaired' as const,
          detail: `${result.reason.replace('-', ' ')} · ${Math.round(result.confidence * 100)}% context match`,
          rect: first,
          board: null,
        }
      }),
    )
  }, [html, placed, fontsLoaded])

  const nextDateLabel = useCallback(
    (index: number) => `Session ${FIRST_SESSION + index}, 1492 DR`,
    [],
  )

  const pinAt = useCallback(
    (clientX: number, clientY: number) => {
      const projection = projectionRef.current
      const element = articleRef.current
      if (!projection || !element) return

      const range = caretRangeFromPoint(clientX, clientY)
      if (!range || !element.contains(range.startContainer)) return

      const flatRange = domRangeToFlatRange(projection, range)
      if (!flatRange) return

      const anchor = createAnchor(projection.flat.text, flatRange.start, flatRange.end)
      if (!anchor.quote) return

      setPlaced((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          anchor,
          board: null,
          body: '',
          occurredAt: CAMPAIGN_EPOCH + previous.length * SESSION_GAP_MS,
          dateLabel: nextDateLabel(previous.length),
        },
      ])
    },
    [nextDateLabel],
  )

  /** Stick a pin straight into the board, at a point in board space. */
  const createFreePin = useCallback(
    (board: Point) => {
      setPlaced((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          anchor: null,
          board,
          body: '',
          occurredAt: CAMPAIGN_EPOCH + previous.length * SESSION_GAP_MS,
          dateLabel: nextDateLabel(previous.length),
        },
      ])
    },
    [nextDateLabel],
  )

  /** Viewport coordinates -> board coordinates. */
  const worldPoint = useCallback((clientX: number, clientY: number): Point => {
    const box = document.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return screenToBoard(cameraRef.current, { x: clientX - box.left, y: clientY - box.top })
  }, [])

  const handleBackgroundClick = useCallback(
    (point: Point) => {
      // The canvas reports viewport coordinates; a pin needs board ones.
      createFreePin(screenToBoard(cameraRef.current, point))
    },
    [createFreePin],
  )

  const handleArticleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const link = wikiLinkFromEvent(event.nativeEvent)
      if (link) {
        event.preventDefault()
        // A wikilink is an address, so it navigates for real.
        navigate({ name: 'wiki', slug: link.resolved ? link.slug : null })
        return
      }
      pinAt(event.clientX, event.clientY)
    },
    [navigate, pinAt],
  )

  const runClock = useCallback(() => {
    const origin = originRef.current
    const path = livePathRef.current
    if (!origin || !path) return

    const spring = springRef.current
    stepSpring(spring.x, targetRef.current.x, 1 / 60)
    stepSpring(spring.y, targetRef.current.y, 1 / 60)
    path.setAttribute('d', yarnPath(origin, { x: spring.x.value, y: spring.y.value }, SLACK))
    frameRef.current = requestAnimationFrame(runClock)
  }, [])

  const beginString = useCallback(
    (event: React.PointerEvent, pin: PinView) => {
      event.stopPropagation()
      event.preventDefault()
      if (!pin.rect) return

      const origin = tackPoint(pin.rect)
      originRef.current = origin
      targetRef.current = origin
      springRef.current = { x: createSpring(origin.x, 220, 22), y: createSpring(origin.y, 220, 22) }
      setDragFrom(pin.id)
      frameRef.current = requestAnimationFrame(runClock)
    },
    [runClock],
  )

  const moveString = useCallback(
    (event: React.PointerEvent) => {
      if (!dragFrom) return
      targetRef.current = worldPoint(event.clientX, event.clientY)
    },
    [dragFrom, worldPoint],
  )

  const endString = useCallback(
    (event: React.PointerEvent) => {
      if (!dragFrom) return
      const drop = worldPoint(event.clientX, event.clientY)

      let nearest: { id: string; distance: number } | null = null
      for (const pin of pins) {
        if (pin.id === dragFrom) continue
        const point = pinPoint(pin, paperPosRef.current)
        if (!point) continue
        const distance = Math.hypot(point.x - drop.x, point.y - drop.y)
        if (distance <= SNAP_RADIUS && (!nearest || distance < nearest.distance)) {
          nearest = { id: pin.id, distance }
        }
      }

      if (nearest) {
        const from = dragFrom
        const to = nearest.id
        setStrings((previous) => {
          const exists = previous.some(
            (s) => (s.from === from && s.to === to) || (s.from === to && s.to === from),
          )
          if (exists) return previous
          return [...previous, { id: crypto.randomUUID(), from, to, color: colorForPair(from, to) }]
        })
      }

      cancelAnimationFrame(frameRef.current)
      originRef.current = null
      setDragFrom(null)
    },
    [dragFrom, worldPoint, pins],
  )

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  /** Right-click: a pin opens its editor, bare board opens the context menu. */
  const handleContextTarget = useCallback((target: BoardContextTarget) => {
    const element = target.target instanceof Element ? target.target : null
    const pinId = element?.closest('[data-pin-id]')?.getAttribute('data-pin-id')

    if (pinId) {
      setEditingPin({ id: pinId, x: target.clientX, y: target.clientY })
      return
    }

    const canvas = document.querySelector('[data-testid="board-canvas"]')
    const box = canvas?.getBoundingClientRect()
    const viewportPoint = box
      ? { x: target.clientX - box.left, y: target.clientY - box.top }
      : { x: 0, y: 0 }

    setContextMenu({
      ...target,
      board: screenToBoard(cameraRef.current, viewportPoint),
    })
  }, [])

  const createPostIt = useCallback(
    (point: Point) => {
      setPostIts((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          x: point.x,
          y: point.y,
          body: '',
          color: POST_IT_COLORS[previous.length % POST_IT_COLORS.length],
          dateLabel: nextDateLabel(previous.length),
        },
      ])
    },
    [nextDateLabel],
  )

  // Tap toggles the editor, drag moves the sheet. Without the tap handler the
  // tab would be a handle you could only drag, never click.
  const paperDrag = useBoardDrag({
    zoom: camera.zoom,
    onDrag: (delta) =>
      setPaperPos((previous) => ({ x: previous.x + delta.x, y: previous.y + delta.y })),
    onTap: () => setDocumentSelected((previous) => !previous),
  })

  const dragPostIt = useCallback(
    (id: string, delta: Point) => {
      setPostIts((previous) =>
        previous.map((item) =>
          item.id === id ? { ...item, x: item.x + delta.x, y: item.y + delta.y } : item,
        ),
      )
    },
    [],
  )

  const setPinBody = useCallback((id: string, body: string) => {
    setPlaced((previous) => previous.map((item) => (item.id === id ? { ...item, body } : item)))
  }, [])

  const setPostItBody = useCallback((id: string, body: string) => {
    setPostIts((previous) => previous.map((item) => (item.id === id ? { ...item, body } : item)))
  }, [])

  const removePin = useCallback((id: string) => {
    setPlaced((previous) => previous.filter((item) => item.id !== id))
    setStrings((previous) => previous.filter((s) => s.from !== id && s.to !== id))
    setEditingPin(null)
  }, [])

  const clearBoard = useCallback(() => {
    setPlaced([])
    setPostIts([])
    setStrings([])
    setEditingPin(null)
    setContextMenu(null)
  }, [])

  const timeline = useMemo(
    () =>
      buildTimeline([
        ...placed.map(
          (item): TimelineEntry => ({
            id: item.id,
            occurredAt: item.occurredAt,
            dateLabel: item.dateLabel,
          }),
        ),
      ]),
    [placed],
  )
  const clusters = useMemo(() => clusterTimeline(timeline), [timeline])
  const activeIds = useMemo(() => new Set(activeAt(timeline, cursor)), [timeline, cursor])

  useEffect(() => {
    if (!playing) return
    if (clusters.length === 0) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => {
      const next = clusters.find((cluster) => cluster.start > cursor)
      if (!next) {
        setPlaying(false)
        return
      }
      setCursor(next.start)
    }, 1200)
    return () => clearTimeout(timer)
  }, [playing, cursor, clusters])

  const togglePlay = useCallback(() => {
    if (!playing && clusters.length > 0) {
      const last = clusters[clusters.length - 1]
      if (cursor >= last.start) setCursor(clusters[0].start)
    }
    setPlaying((previous) => !previous)
  }, [playing, cursor, clusters])

  const byId = useMemo(() => new Map(pins.map((pin) => [pin.id, pin])), [pins])
  const dimming = placed.length > 0

  const drawableStrings = strings.flatMap((string) => {
    const from = byId.get(string.from)
    const to = byId.get(string.to)
    if (!from || !to) return []

    const fromPoint = pinPoint(from, paperPos)
    const toPoint = pinPoint(to, paperPos)
    if (!fromPoint || !toPoint) return []

    return [
      {
        id: string.id,
        fromId: string.from,
        toId: string.to,
        color: string.color,
        from: fromPoint,
        to: toPoint,
      },
    ]
  })

  const anchored = pins.filter((pin) => pin.rect)
  const freePins = pins.filter((pin) => pin.board)
  const orphaned = pins.filter((pin) => pin.status === 'orphaned')
  const repaired = pins.filter((pin) => pin.status === 'repaired').length
  const activePin = editingPin ? byId.get(editingPin.id) : null

  const contextItems: ContextMenuEntry[] = contextMenu
    ? [
        {
          id: 'post-it',
          label: 'Create post-it',
          hint: 'A loose note on the board',
          onSelect: () => createPostIt(contextMenu.board),
        },
        {
          id: 'pin',
          label: 'Add pin',
          hint: 'Pin a note to the text under the cursor',
          onSelect: () => pinAt(contextMenu.clientX, contextMenu.clientY),
        },
        { id: 'sep-1', separator: true },
        {
          id: 'fit',
          label: 'Zoom to fit',
          hint: 'Frame the document',
          disabled: !paperRect,
          onSelect: () => {
            const canvas = document.querySelector('[data-testid="board-canvas"]')
            const box = canvas?.getBoundingClientRect()
            if (!paperRect || !box || box.width === 0) return
            const fitted = fitBounds([paperRect], { width: box.width, height: box.height }, 56)
            if (fitted) setCamera(fitted)
          },
        },
        {
          id: 'prefs',
          label: 'Preferences…',
          onSelect: () => setPrefsOpen(true),
        },
      ]
    : []

  return (
    <div className="app-shell flex h-screen flex-col overflow-hidden">
      <TopBar
        route={route}
        navigate={navigate}
        onOpenPreferences={() => setPrefsOpen(true)}
        preferencesOpen={prefsOpen}
        preferencesPanelId={PREFERENCES_PANEL_ID}
      >
        {route.name === 'board' && (
          <>
            <button
              type="button"
              onClick={() =>
                setSource((current) =>
                  current.replace(
                    '\n\n**Session 12**',
                    '\n\nIt rained the whole crossing, and the lanterns guttered.\n\n**Session 12**',
                  ),
                )
              }
              className="rounded border border-brass/40 bg-cork-700/70 px-2.5 py-1 text-xs text-board-ink transition hover:border-brass"
            >
              Insert a sentence above
            </button>
            <button
              type="button"
              onClick={() =>
                setSource((current) =>
                  current.replace(
                    /The \[\[The Black Coin\|Black Coin\]\][^\n]*\n?[^\n]*\n?/,
                    'Nobody would say the name aloud.\n',
                  ),
                )
              }
              className="rounded border border-brass/40 bg-cork-700/70 px-2.5 py-1 text-xs text-board-ink transition hover:border-brass"
            >
              Delete the pinned sentence
            </button>
          </>
        )}
      </TopBar>

      <main className="relative flex min-h-0 flex-1">
        {route.name === 'wiki' ? (
          <div className="min-h-0 flex-1 overflow-auto p-5 lg:p-8">
            <WikiView
              html={html}
              pins={placed.flatMap((item) =>
                item.anchor
                  ? [{ id: item.id, anchor: item.anchor, dateLabel: item.dateLabel }]
                  : [],
              )}
              activeIds={activeIds}
              dimming={dimming}
              fontsLoaded={fontsLoaded}
              onShowOnBoard={() => setDocumentSelected(true)}
            />
          </div>
        ) : (
          <>
            {documentSelected && (
              <PaperEditor
                title={ARTICLE_TITLE}
                value={source}
                onChange={setSource}
                onClose={() => setDocumentSelected(false)}
              />
            )}

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <BoardCanvas
                camera={camera}
                onCameraChange={setCamera}
                onContextTarget={handleContextTarget}
                onBackgroundClick={handleBackgroundClick}
                className="min-h-0 flex-1"
                fitTo={paperRect ? [paperRect] : undefined}
                backdrop={(viewport) => (
                  <GridLayer camera={camera} viewport={viewport} />
                )}
              >
                <svg
                  className="pointer-events-none absolute top-0 left-0 overflow-visible"
                  width={1}
                  height={1}
                  aria-hidden="true"
                >
                  {drawableStrings.map((string) => (
                    <g
                      key={string.id}
                      className="transition-opacity duration-300"
                      style={{
                        opacity:
                          !dimming || (activeIds.has(string.fromId) && activeIds.has(string.toId))
                            ? 1
                            : 0.12,
                      }}
                    >
                      {yarnStrands(
                        preferences.yarnStyle,
                        string.from,
                        string.to,
                        SLACK,
                        seedFromKey(string.id),
                      ).map((strand, index) => (
                        <path
                          key={index}
                          d={strand.d}
                          fill="none"
                          stroke={YARN_HEX[string.color]}
                          strokeWidth={strand.width}
                          strokeOpacity={strand.opacity}
                          strokeLinecap="round"
                        />
                      ))}
                    </g>
                  ))}

                  <path
                    ref={livePathRef}
                    fill="none"
                    stroke={YARN_HEX[colorForPair(dragFrom ?? 'a', 'b')]}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    opacity={dragFrom ? 0.95 : 0}
                  />
                </svg>

                <div
                  ref={paperRef}
                  data-testid="paper"
                  className={`parchment absolute top-0 left-0 rounded-sm px-9 py-8 shadow-xl sm:px-12 sm:py-10 ${
                    documentSelected ? 'ring-2 ring-brass/70' : ''
                  }`}
                  style={{
                    width: PAPER_WIDTH,
                    transform: `translate3d(${paperPos.x}px, ${paperPos.y}px, 0)`,
                  }}
                >
                  {/* The tab is the selection affordance. Clicking the body of
                      the paper pins a note; clicking the tab selects the
                      document and opens the editor. Two gestures, one sheet. */}
                  <button
                    type="button"
                    data-testid="paper-tab"
                    {...paperDrag}
                    aria-pressed={documentSelected}
                    className={`absolute -top-7 left-0 rounded-t px-3 py-1 text-[11px] transition ${
                      documentSelected
                        ? 'bg-brass/80 text-cork-900'
                        : 'bg-parchment-200/85 text-ink-soft hover:bg-parchment-200'
                    }`}
                    title="Click to edit, drag to move"
                  >
                    {documentSelected ? '▾ ' : '▸ '}
                    {ARTICLE_TITLE}
                  </button>

                  <div
                    className="relative"
                    onPointerMove={moveString}
                    onPointerUp={endString}
                    onPointerLeave={endString}
                  >
                    <div
                      ref={articleRef}
                      onClick={handleArticleClick}
                      className="article relative cursor-text select-text"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />

                    <div ref={overlayRef} className="pointer-events-none absolute inset-0">

                      {anchored.map((pin) =>
                        pin.rect ? (
                          <div
                            key={`mark-${pin.id}`}
                            className="anchor-mark absolute transition-opacity duration-300"
                            data-status={pin.status}
                            style={{
                              left: pin.rect.x,
                              top: pin.rect.y,
                              width: pin.rect.width,
                              height: pin.rect.height,
                              opacity: !dimming || activeIds.has(pin.id) ? 1 : 0.16,
                            }}
                          />
                        ) : null,
                      )}

                      {anchored.map((pin) =>
                        pin.rect ? (
                          <button
                            key={`tack-${pin.id}`}
                            type="button"
                            data-pin-id={pin.id}
                            onPointerDown={(event) => beginString(event, pin)}
                            className="tack tack-enter pointer-events-auto absolute h-3.5 w-3.5 cursor-crosshair rounded-full transition-opacity duration-300"
                            data-status={pin.status}
                            style={{
                              left: pin.rect.x + pin.rect.width - 6,
                              top: pin.rect.y - 5,
                              touchAction: 'none',
                              opacity: !dimming || activeIds.has(pin.id) ? 1 : 0.2,
                            }}
                            title={`${pin.quote} — ${pin.detail}`}
                            aria-label={`Pin on "${pin.quote}", ${pin.detail}`}
                          />
                        ) : null,
                      )}
                    </div>
                  </div>
                </div>

                {/* Pins stuck into the cork rather than into text. Same object
                    as an anchored pin, different location — which is why they
                    share the note editor and the yarn. */}
                {freePins.map((pin) =>
                  pin.board ? (
                    <button
                      key={`free-${pin.id}`}
                      type="button"
                      data-pin-id={pin.id}
                      onPointerDown={(event) => beginString(event, pin)}
                      className="tack tack-enter absolute h-3.5 w-3.5 cursor-crosshair rounded-full"
                      data-status="free"
                      style={{
                        left: pin.board.x - 7,
                        top: pin.board.y - 7,
                        touchAction: 'none',
                        opacity: !dimming || activeIds.has(pin.id) ? 1 : 0.2,
                      }}
                      title={pin.body || 'Empty pin — right-click to write'}
                      aria-label={`Pin on the board${pin.body ? `: ${pin.body}` : ''}`}
                    />
                  ) : null,
                )}

                {postIts.map((note) => (
                  <PostIt
                    key={note.id}
                    note={note}
                    zoom={camera.zoom}
                    onDrag={dragPostIt}
                    onChange={setPostItBody}
                    onRemove={(id) =>
                      setPostIts((previous) => previous.filter((item) => item.id !== id))
                    }
                  />
                ))}
              </BoardCanvas>
            </div>
          </>
        )}
      </main>

      {route.name === 'board' && (
        <footer className="border-t border-parchment-edge/15 bg-cork-900/55 px-4 py-2 lg:px-6">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pb-1 text-[10px] text-board-ink-soft/50">
            <Legend
              colour="var(--color-brass)"
              label={`Anchored exactly (${pins.length - repaired - orphaned.length})`}
            />
            <Legend colour="#d98a2b" label={`Repaired after an edit (${repaired})`} />
            <Legend colour="var(--color-wax)" label={`Orphaned (${orphaned.length})`} />
            <span>
              {placed.length} pin{placed.length === 1 ? '' : 's'} · {strings.length} string
              {strings.length === 1 ? '' : 's'}
            </span>
            <span className="ml-auto hidden lg:inline">
              Scroll to zoom · right/middle-drag to pan · right-click for options
            </span>
          </div>
          <TimelineRibbon
            timeline={timeline}
            clusters={clusters}
            cursor={cursor}
            onScrub={(time) => {
              setPlaying(false)
              setCursor(time)
            }}
            playing={playing}
            onTogglePlay={togglePlay}
            activeCount={activeIds.size}
            totalCount={timeline.placed.length}
          />
        </footer>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.clientX}
          y={contextMenu.clientY}
          items={contextItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {editingPin && activePin && (
        <PinEditor
          quote={activePin.quote}
          status={activePin.status === 'free' ? 'exact' : activePin.status}
          dateLabel={placed.find((item) => item.id === editingPin.id)?.dateLabel ?? ''}
          body={activePin.body}
          x={editingPin.x}
          y={editingPin.y}
          onChange={(body) => setPinBody(editingPin.id, body)}
          onDelete={() => removePin(editingPin.id)}
          onClose={() => setEditingPin(null)}
        />
      )}

      <PreferencesPanel
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        onClearBoard={clearBoard}
      />
    </div>
  )
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: colour }} />
      {label}
    </span>
  )
}


/**
 * A post-it on the board.
 *
 * Its own component because it needs a drag hook, and hooks cannot live inside
 * a `.map`. The body is edited in place — a post-it is a thing you scribble on,
 * so opening a dialog to do it would be a step backwards.
 */
function PostIt({
  note,
  zoom,
  onDrag,
  onChange,
  onRemove,
}: {
  note: PostIt
  zoom: number
  onDrag: (id: string, delta: Point) => void
  onChange: (id: string, body: string) => void
  onRemove: (id: string) => void
}) {
  const drag = useBoardDrag({
    zoom,
    onDrag: (delta) => onDrag(note.id, delta),
  })

  return (
    <div
      className="post-it absolute rounded-sm p-2"
      style={{
        left: note.x,
        top: note.y,
        width: 168,
        background: note.color,
      }}
    >
      {/* The header is the grab handle, so dragging never fights with selecting
          text inside the note. */}
      <div
        {...drag}
        className="mb-1 h-3 cursor-grab rounded-sm bg-black/5 active:cursor-grabbing"
        title="Drag to move"
        aria-label="Drag post-it"
      />
      <textarea
        value={note.body}
        onChange={(event) => onChange(note.id, event.target.value)}
        placeholder="Write something…"
        className="h-24 w-full resize-none bg-transparent text-[12px] leading-snug text-ink outline-none placeholder:text-ink-soft/40"
        aria-label="Post-it note"
      />
      <button
        type="button"
        onClick={() => onRemove(note.id)}
        className="absolute top-1 right-1 text-[11px] text-ink-soft/40 transition hover:text-wax"
        aria-label="Remove post-it"
      >
        ×
      </button>
    </div>
  )
}
