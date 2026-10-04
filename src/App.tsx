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
import { WikiView } from './wiki/WikiView'
import { linkifyHtml, wikiLinkFromEvent } from './wiki/linkify'
import { slugify } from './wiki/links'
import { IDENTITY_CAMERA } from './board/camera'
import { TimelineRibbon } from './board/TimelineRibbon'
import { Ambient } from './theme/Ambient'
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

/**
 * The demo's article index. In the real app this comes from the database; here
 * it exists so links resolve (and, for [[The Sea Ghost]], deliberately don't).
 */
const DEMO_ARTICLES = [
  { slug: 'saltmarsh', title: 'Saltmarsh' },
  { slug: 'molgar-the-pale', title: 'Molgar the Pale' },
  { slug: 'the-black-coin', title: 'The Black Coin' },
  { slug: 'the-drowned-bell', title: 'The Drowned Bell' },
]

/** How much rope a string has, as a fraction of the gap it spans. */
const SLACK = 0.18

/** Pointer slop for "did they drop on that pin". */
const SNAP_RADIUS = 34

/**
 * Demo dates. A real board takes these from the item's own `date_label` and
 * `occurred_at`; here each pin lands a fortnight after the last, so the
 * chronology fills in as you place pins and the session clustering has
 * something honest to work with.
 */
const CAMPAIGN_EPOCH = Date.UTC(2026, 0, 10)
const SESSION_GAP_MS = 14 * 24 * 60 * 60 * 1000
const FIRST_SESSION = 12

interface PinView {
  id: string
  quote: string
  status: 'exact' | 'repaired' | 'orphaned'
  detail: string
  rect: AnchorRect | null
}

interface PlacedAnchor {
  id: string
  anchor: TextAnchor
  /** Sortable date driving the chronology. */
  occurredAt: number
  /** What the ribbon displays verbatim. */
  dateLabel: string
}

interface StringView {
  id: string
  from: string
  to: string
  color: YarnColor
}

/**
 * The caret under a click.
 *
 * Chrome/Safari expose `caretRangeFromPoint`, Firefox `caretPositionFromPoint`.
 * Both are needed — a plain click produces no selection, so this is the only
 * way to turn "the user clicked that word" into a DOM position.
 */
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

/** The tack's centre, in the article's coordinate space. */
function tackPoint(rect: AnchorRect): Point {
  return { x: rect.x + rect.width - 6 + 7, y: rect.y - 5 + 7 }
}

export function App() {
  const [source, setSource] = useState(INITIAL_MARKDOWN)
  const [placed, setPlaced] = useState<PlacedAnchor[]>([])
  const [pins, setPins] = useState<PinView[]>([])
  const [strings, setStrings] = useState<StringView[]>([])
  const [dragFrom, setDragFrom] = useState<string | null>(null)
  // Environments without the Font Loading API (jsdom, some embedded webviews)
  // have no webfonts to wait for, so start settled. Waiting on a promise that
  // will never resolve would leave the board permanently unmeasured.
  const [fontsLoaded, setFontsLoaded] = useState(() => !globalThis.document?.fonts)
  const [cursor, setCursor] = useState(CAMPAIGN_EPOCH)
  const [playing, setPlaying] = useState(false)
  const [view, setView] = useState<'board' | 'wiki'>('board')

  const articleRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const livePathRef = useRef<SVGPathElement>(null)
  const projectionRef = useRef<DomProjection | null>(null)

  // The trailing end of a string being drawn. Updated at 60fps by mutating the
  // path's `d` attribute directly — never through React state, which would
  // re-render the whole board every frame.
  const springRef = useRef({ x: createSpring(0), y: createSpring(0) })
  const targetRef = useRef<Point>({ x: 0, y: 0 })
  const originRef = useRef<Point | null>(null)
  const frameRef = useRef<number>(0)

  const resolveWikiTarget = useCallback((target: string) => {
    const wanted = slugify(target)
    return (
      DEMO_ARTICLES.find(
        (article) =>
          article.slug === wanted || article.title.toLowerCase() === target.toLowerCase(),
      )?.slug ?? null
    )
  }, [])

  // Sanitize, then linkify — in that order, and both before the article reaches
  // the DOM. Linkifying *after* the article was projected would shift every
  // offset below a link by the width of the brackets it removes, and every pin
  // under it would land on the wrong words.
  const html = useMemo(
    () =>
      linkifyHtml(DOMPurify.sanitize(marked.parse(source, { async: false })), {
        resolve: resolveWikiTarget,
      }),
    [source, resolveWikiTarget],
  )

  // Measure nothing until webfonts have loaded. Measuring against fallback
  // metrics puts every pin slightly wrong, and nothing in the code looks
  // incorrect — the failure is silent.
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

  // After every render of the article, re-project the DOM and re-resolve every
  // anchor against the current text. This is the thesis in one effect: edit the
  // source, and the pins find their own way back.
  useLayoutEffect(() => {
    const element = articleRef.current
    if (!element || !fontsLoaded) return

    const projection = projectDom(element)
    projectionRef.current = projection

    setPins(
      placed.map(({ id, anchor }) => {
        const result = resolveAnchor(projection.flat.text, anchor)

        if (result.status === 'orphaned') {
          return {
            id,
            quote: anchor.quote,
            status: 'orphaned' as const,
            detail:
              result.reason === 'empty-quote'
                ? 'no text to anchor to'
                : 'the words it was pinned to are gone',
            rect: null,
          }
        }

        const range = flatRangeToDomRange(projection, result.start, result.end)
        const rects = range ? rangeToContainerRects(range, element) : []
        const first = rects[0] ?? null

        if (result.status === 'exact') {
          return {
            id,
            quote: anchor.quote,
            status: 'exact' as const,
            detail: 'unchanged',
            rect: first,
          }
        }

        return {
          id,
          quote: anchor.quote,
          status: 'repaired' as const,
          detail: `${result.reason.replace('-', ' ')} · ${Math.round(result.confidence * 100)}% context match`,
          rect: first,
        }
      }),
    )
  }, [html, placed, fontsLoaded])

  const handleArticleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // A click on a wikilink navigates. It must not also drop a pin — the two
    // gestures share a surface, and pinning on every attempt to follow a link
    // would make the board unusable.
    const link = wikiLinkFromEvent(event.nativeEvent)
    if (link) {
      event.preventDefault()
      setView('wiki')
      return
    }

    const projection = projectionRef.current
    const element = articleRef.current
    if (!projection || !element) return

    const range = caretRangeFromPoint(event.clientX, event.clientY)
    if (!range || !element.contains(range.startContainer)) return

    const flatRange = domRangeToFlatRange(projection, range)
    if (!flatRange) return

    const anchor = createAnchor(projection.flat.text, flatRange.start, flatRange.end)
    if (!anchor.quote) return // clicked somewhere with no word to hold onto

    setPlaced((previous) => {
      const session = FIRST_SESSION + previous.length
      return [
        ...previous,
        {
          id: crypto.randomUUID(),
          anchor,
          occurredAt: CAMPAIGN_EPOCH + previous.length * SESSION_GAP_MS,
          dateLabel: `Session ${session}, 1492 DR`,
        },
      ]
    })
  }, [])

  /** Pointer position in the article's coordinate space. */
  const localPoint = useCallback((clientX: number, clientY: number): Point => {
    const box = overlayRef.current?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return { x: clientX - box.left, y: clientY - box.top }
  }, [])

  /**
   * The board clock.
   *
   * One rAF loop for the whole board, running only while a string is actually
   * being drawn. It writes the path's `d` attribute directly rather than going
   * through React — a setState per frame would re-render every pin on the
   * board sixty times a second.
   */
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
      // Don't let the press fall through and drop a new pin on the article.
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
      targetRef.current = localPoint(event.clientX, event.clientY)
    },
    [dragFrom, localPoint],
  )

  const endString = useCallback(
    (event: React.PointerEvent) => {
      if (!dragFrom) return

      const drop = localPoint(event.clientX, event.clientY)

      // Snap to whichever other pin is nearest the drop, within slop.
      let nearest: { id: string; distance: number } | null = null
      for (const pin of pins) {
        if (pin.id === dragFrom || !pin.rect) continue
        const point = tackPoint(pin.rect)
        const d = Math.hypot(point.x - drop.x, point.y - drop.y)
        if (d <= SNAP_RADIUS && (!nearest || d < nearest.distance)) {
          nearest = { id: pin.id, distance: d }
        }
      }

      if (nearest) {
        const from = dragFrom
        const to = nearest.id
        setStrings((previous) => {
          const exists = previous.some(
            (s) =>
              (s.from === from && s.to === to) || (s.from === to && s.to === from),
          )
          if (exists) return previous
          return [...previous, { id: crypto.randomUUID(), from, to, color: colorForPair(from, to) }]
        })
      }

      cancelAnimationFrame(frameRef.current)
      originRef.current = null
      setDragFrom(null)
    },
    [dragFrom, localPoint, pins],
  )

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  const insertAbove = useCallback(() => {
    setSource((current) =>
      current.replace(
        '\n\n**Session 12**',
        '\n\nIt rained the whole crossing, and the lanterns guttered.\n\n**Session 12**',
      ),
    )
  }, [])

  const rewriteEnding = useCallback(() => {
    setSource((current) =>
      current.replace(
        /The \*\*Black Coin\*\*[^\n]*\n?[^\n]*\n?/,
        'Nobody would say the name aloud.\n',
      ),
    )
  }, [])

  const clearAll = useCallback(() => {
    setPlaced([])
    setStrings([])
  }, [])

  const timeline = useMemo(
    () =>
      buildTimeline(
        placed.map(
          (item): TimelineEntry => ({
            id: item.id,
            occurredAt: item.occurredAt,
            dateLabel: item.dateLabel,
          }),
        ),
      ),
    [placed],
  )
  const clusters = useMemo(() => clusterTimeline(timeline), [timeline])
  const activeIds = useMemo(() => new Set(activeAt(timeline, cursor)), [timeline, cursor])

  // The recap. Each step is scheduled against the current cursor, so advancing
  // reschedules the next one and running out of clusters ends the playback
  // without needing a separate "am I done" check.
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
      // Pressing play at the end restarts the recap rather than doing nothing.
      const last = clusters[clusters.length - 1]
      if (cursor >= last.start) setCursor(clusters[0].start)
    }
    setPlaying((previous) => !previous)
  }, [playing, cursor, clusters])

  const byId = useMemo(() => new Map(pins.map((pin) => [pin.id, pin])), [pins])
  /** Dimming only applies once there is a chronology to walk through. */
  const dimming = placed.length > 0
  const anchored = pins.filter((pin) => pin.rect)
  const orphaned = pins.filter((pin) => pin.status === 'orphaned')
  const repaired = pins.filter((pin) => pin.status === 'repaired').length

  /**
   * Strings whose endpoints both still resolve.
   *
   * Keeps the pin ids alongside the resolved points: the endpoints are what get
   * drawn, but the ids are what the timeline compares against.
   */
  const drawableStrings = strings.flatMap((string) => {
    const from = byId.get(string.from)
    const to = byId.get(string.to)
    if (!from?.rect || !to?.rect) return []
    return [
      {
        id: string.id,
        fromId: string.from,
        toId: string.to,
        color: string.color,
        from: tackPoint(from.rect),
        to: tackPoint(to.rect),
      },
    ]
  })

  return (
    <div className="cork relative min-h-full p-5 lg:p-8">
      {/* Dust and candlelight. Sits behind everything and takes no pointer
          events, so it never competes with the board for clicks. */}
      <Ambient camera={IDENTITY_CAMERA} />

      <div className="relative mx-auto max-w-[1500px]">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-parchment-100">
              The Case Board
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-parchment-300/80">
              Click any word to pin it. Drag from one brass tack to another to run a string
              between them. Then edit the article above a pin and watch where it lands.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* The same article, the same pins, two renderings. */}
            <div
              className="flex overflow-hidden rounded border border-brass/40"
              role="group"
              aria-label="View"
            >
              {(['board', 'wiki'] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setView(option)}
                  aria-pressed={view === option}
                  className={`px-3 py-1.5 text-sm capitalize transition ${
                    view === option
                      ? 'bg-brass/25 text-parchment-100'
                      : 'bg-cork-700/70 text-parchment-300 hover:text-parchment-100'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>

            <button
              onClick={insertAbove}
              className="rounded border border-brass/40 bg-cork-700/70 px-3 py-1.5 text-sm text-parchment-200 transition hover:border-brass hover:bg-cork-700"
            >
              Insert a sentence above
            </button>
            <button
              onClick={rewriteEnding}
              className="rounded border border-brass/40 bg-cork-700/70 px-3 py-1.5 text-sm text-parchment-200 transition hover:border-brass hover:bg-cork-700"
            >
              Delete the pinned sentence
            </button>
            <button
              onClick={clearAll}
              className="rounded border border-parchment-edge/25 px-3 py-1.5 text-sm text-parchment-300 transition hover:border-wax hover:text-parchment-100"
            >
              Clear board
            </button>
          </div>
        </header>

        {view === 'wiki' ? (
          <WikiView
            html={html}
            pins={placed.map((item) => ({
              id: item.id,
              anchor: item.anchor,
              dateLabel: item.dateLabel,
            }))}
            activeIds={activeIds}
            dimming={dimming}
            fontsLoaded={fontsLoaded}
            onShowOnBoard={() => setView('board')}
          />
        ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <section className="flex flex-col">
            <h2 className="mb-2 text-xs font-semibold tracking-[0.14em] text-brass uppercase">
              Markdown source
            </h2>
            <textarea
              value={source}
              onChange={(event) => setSource(event.target.value)}
              spellCheck={false}
              className="editor h-[620px] resize-none rounded p-4 text-[13px]"
              aria-label="Article markdown source"
            />
          </section>

          <section className="flex flex-col">
            <h2 className="mb-2 text-xs font-semibold tracking-[0.14em] text-brass uppercase">
              The board
            </h2>

            <div>
              <div className="parchment rounded-sm px-9 py-8 sm:px-12 sm:py-10">
                {/* The article's own box is the coordinate space for pins and
                    yarn, so rects measured against the article line up with the
                    overlay without compensating for the parchment's padding. */}
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
                    {/* Yarn. Painted under the tacks, never interactive — a
                        click should fall through to the text beneath it. */}
                    <svg className="absolute inset-0 h-full w-full overflow-visible">
                      {drawableStrings.map((string) => (
                        <g
                          key={string.id}
                          className="transition-opacity duration-300"
                          style={{
                            // A string is live only when both ends are known —
                            // a thread to something the party hasn't found yet
                            // would be a lie the board tells.
                            opacity:
                              !dimming ||
                              (activeIds.has(string.fromId) && activeIds.has(string.toId))
                                ? 1
                                : 0.12,
                          }}
                        >
                          {/* A dark underlay gives the yarn a shadow, so it
                              reads as lying on the paper rather than in it. */}
                          <path
                            d={yarnPath(string.from, string.to, SLACK)}
                            fill="none"
                            stroke="rgba(0,0,0,0.22)"
                            strokeWidth={3.5}
                            strokeLinecap="round"
                            transform="translate(0.5 1.5)"
                          />
                          <path
                            d={yarnPath(string.from, string.to, SLACK)}
                            fill="none"
                            stroke={YARN_HEX[string.color]}
                            strokeWidth={2.5}
                            strokeLinecap="round"
                          />
                        </g>
                      ))}

                      {/* The string currently being drawn, driven by the board
                          clock and updated outside React entirely. */}
                      <path
                        ref={livePathRef}
                        fill="none"
                        stroke={YARN_HEX[colorForPair(dragFrom ?? 'a', 'b')]}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeDasharray={dragFrom ? undefined : '0'}
                        opacity={dragFrom ? 0.95 : 0}
                      />
                    </svg>

                    {/* Anchor marks */}
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
                            // Dimmed via opacity rather than a filter: filters
                            // repaint their subtree every frame, whereas opacity
                            // is compositor-only. Dimming hundreds of marks with
                            // `filter: saturate()` is what tanks the frame rate.
                            opacity: !dimming || activeIds.has(pin.id) ? 1 : 0.16,
                          }}
                        />
                      ) : null,
                    )}

                    {/* Tacks. The only interactive part of the overlay — drag
                        from one to another to run a string. */}
                    {anchored.map((pin) =>
                      pin.rect ? (
                        <button
                          key={`tack-${pin.id}`}
                          type="button"
                          onPointerDown={(event) => beginString(event, pin)}
                          className="tack tack-enter pointer-events-auto absolute h-3.5 w-3.5 cursor-crosshair rounded-full transition-opacity duration-300"
                          data-status={pin.status}
                          style={{
                            left: pin.rect.x + pin.rect.width - 6,
                            top: pin.rect.y - 5,
                            touchAction: 'none',
                            opacity: !dimming || activeIds.has(pin.id) ? 1 : 0.2,
                          }}
                          title={
                            dragFrom
                              ? 'Drop on another pin to run a string'
                              : `${pin.quote} — ${pin.detail}. Drag to another pin to connect.`
                          }
                          aria-label={`Pin on "${pin.quote}", ${pin.detail}`}
                        />
                      ) : null,
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-parchment-300/80">
                <Legend
                  colour="var(--color-brass)"
                  label={`Anchored exactly (${pins.length - repaired - orphaned.length})`}
                />
                <Legend colour="#d98a2b" label={`Repaired after an edit (${repaired})`} />
                <Legend colour="var(--color-wax)" label={`Orphaned (${orphaned.length})`} />
                <span className="text-parchment-300/50">
                  {placed.length} pin{placed.length === 1 ? '' : 's'} · {strings.length} string
                  {strings.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            {orphaned.length > 0 && (
              <div className="mt-5 rounded border border-wax/40 bg-cork-900/50 p-4">
                <h3 className="text-xs font-semibold tracking-[0.14em] text-wax uppercase">
                  Loose pins — the trail went cold
                </h3>
                <p className="mt-1 mb-3 text-xs text-parchment-300/70">
                  The text these were pinned to no longer exists. They are kept, not discarded, so
                  they can be re-attached.
                </p>
                <ul className="flex flex-wrap gap-2">
                  {orphaned.map((pin) => (
                    <li
                      key={pin.id}
                      className="flex items-center gap-2 rounded border border-parchment-edge/25 bg-cork-700/60 px-2.5 py-1.5 text-xs"
                    >
                      <span className="h-2.5 w-2.5 rounded-full bg-wax" />
                      <span className="text-parchment-200 italic">“{pin.quote}”</span>
                      <span className="text-parchment-300/50">{pin.detail}</span>
                      <button
                        onClick={() => {
                          setPlaced((previous) => previous.filter((item) => item.id !== pin.id))
                          setStrings((previous) =>
                            previous.filter((s) => s.from !== pin.id && s.to !== pin.id),
                          )
                        }}
                        className="ml-1 text-parchment-300/50 transition hover:text-wax"
                        aria-label={`Discard pin on ${pin.quote}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
        )}

        <div className="mt-7">
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
        </div>
      </div>
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
