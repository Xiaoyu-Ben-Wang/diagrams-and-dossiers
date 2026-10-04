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

const INITIAL_MARKDOWN = `# The Drowned Bell

**Session 12** — 3rd of Eleint, 1492 DR

The party returned to **Saltmarsh** with the bell they pulled from the
*Sea Ghost*. Molgar paid the ferryman in silver and said nothing at all
about the water.

## What we know

- The bell rings at low tide, though no hand touches it
- Three dockworkers have gone missing since the harvest festival
- The harbormaster's ledger lists a fourth name, scratched out

> "The tide keeps what it takes," the ferryman said.

The **Black Coin** came up twice: once from the ferryman, and once in
the ledger, in a hand nobody recognised.
`

/** A pin as the board currently sees it: resolved, repaired, or lost. */
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
}

/**
 * The caret under a click.
 *
 * Chrome/Safari expose `caretRangeFromPoint`, Firefox `caretPositionFromPoint`.
 * Both are needed — this is the only way to turn "user clicked that word" into
 * a DOM position, since a plain click produces no selection.
 */
function caretRangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null
  }

  if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y)

  const position = doc.caretPositionFromPoint?.(x, y)
  if (!position) return null
  const range = document.createRange()
  range.setStart(position.offsetNode, position.offset)
  range.collapse(true)
  return range
}

export function App() {
  const [source, setSource] = useState(INITIAL_MARKDOWN)
  const [placed, setPlaced] = useState<PlacedAnchor[]>([])
  const [pins, setPins] = useState<PinView[]>([])
  const [fontsLoaded, setFontsLoaded] = useState(false)

  const articleRef = useRef<HTMLDivElement>(null)
  const projectionRef = useRef<DomProjection | null>(null)

  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(source, { async: false })),
    [source],
  )

  // Measure nothing until webfonts have loaded. Measuring against fallback
  // metrics puts every pin slightly wrong, and nothing in the code looks
  // incorrect — the failure is invisible.
  useEffect(() => {
    let cancelled = false
    void Promise.resolve(document.fonts?.ready).then(() => {
      if (!cancelled) setFontsLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // After every render of the article, re-project the DOM and re-resolve every
  // anchor against the current text. This is the whole thesis in one effect:
  // edit the source, and the pins find their own way back.
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
          return { id, quote: anchor.quote, status: 'exact' as const, detail: 'unchanged', rect: first }
        }

        const percentage = Math.round(result.confidence * 100)
        return {
          id,
          quote: anchor.quote,
          status: 'repaired' as const,
          detail: `${result.reason.replace('-', ' ')} · ${percentage}% context match`,
          rect: first,
        }
      }),
    )
  }, [html, placed, fontsLoaded])

  const handleArticleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const projection = projectionRef.current
    const element = articleRef.current
    if (!projection || !element) return

    const range = caretRangeFromPoint(event.clientX, event.clientY)
    if (!range || !element.contains(range.startContainer)) return

    const flatRange = domRangeToFlatRange(projection, range)
    if (!flatRange) return

    const anchor = createAnchor(projection.flat.text, flatRange.start, flatRange.end)
    if (!anchor.quote) return // clicked somewhere with no word to hold onto

    setPlaced((previous) => [...previous, { id: crypto.randomUUID(), anchor }])
  }, [])

  /** Demonstrate the everyday case: an edit above the pins. */
  const insertAbove = useCallback(() => {
    setSource((current) =>
      current.replace(
        '\n\n**Session 12**',
        '\n\nIt rained the whole crossing, and the lanterns guttered.\n\n**Session 12**',
      ),
    )
  }, [])

  /** Demonstrate the failure case: the anchored words are deleted outright. */
  const rewriteEnding = useCallback(() => {
    setSource((current) =>
      current.replace(
        /The \*\*Black Coin\*\*[^\n]*\n?[^\n]*\n?/,
        'Nobody would say the name aloud.\n',
      ),
    )
  }, [])

  const repaired = pins.filter((pin) => pin.status === 'repaired').length
  const orphaned = pins.filter((pin) => pin.status === 'orphaned')
  const anchored = pins.filter((pin) => pin.rect)

  return (
    <div className="cork min-h-full p-5 lg:p-8">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-parchment-100">
              The Case Board
            </h1>
            <p className="mt-1 text-sm text-parchment-300/80">
              Click any word in the article to pin it. Then edit the article above the pin and
              watch where it lands.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
              onClick={() => setPlaced([])}
              className="rounded border border-parchment-edge/25 px-3 py-1.5 text-sm text-parchment-300 transition hover:border-wax hover:text-parchment-100"
            >
              Clear pins
            </button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          {/* Source */}
          <section className="flex flex-col">
            <h2 className="mb-2 text-xs font-semibold tracking-[0.14em] text-brass uppercase">
              Markdown source
            </h2>
            <textarea
              value={source}
              onChange={(event) => setSource(event.target.value)}
              spellCheck={false}
              className="editor h-[560px] resize-none rounded p-4 text-[13px]"
              aria-label="Article markdown source"
            />
          </section>

          {/* Board */}
          <section className="flex flex-col">
            <h2 className="mb-2 text-xs font-semibold tracking-[0.14em] text-brass uppercase">
              The board
            </h2>

            <div className="relative">
              <div className="parchment relative rounded-sm px-9 py-8 sm:px-12 sm:py-10">
                <div
                  ref={articleRef}
                  onClick={handleArticleClick}
                  className="article relative cursor-text select-text"
                  dangerouslySetInnerHTML={{ __html: html }}
                />

                {/* Pins, and the mark each leaves on the words it holds. */}
                {anchored.map((pin) =>
                  pin.rect ? (
                    <div key={pin.id} className="pointer-events-none absolute inset-0">
                      <div
                        className="anchor-mark absolute"
                        style={{
                          left: pin.rect.x,
                          top: pin.rect.y,
                          width: pin.rect.width,
                          height: pin.rect.height,
                        }}
                        data-status={pin.status}
                      />
                      <div
                        className="tack tack-enter absolute h-3.5 w-3.5 rounded-full"
                        data-status={pin.status}
                        style={{
                          left: pin.rect.x + pin.rect.width - 6,
                          top: pin.rect.y - 5,
                        }}
                        title={`${pin.quote} — ${pin.detail}`}
                      />
                    </div>
                  ) : null,
                )}
              </div>

              {/* Status strip */}
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-parchment-300/80">
                <Legend colour="var(--color-brass)" label={`Anchored exactly (${pins.length - repaired - orphaned.length})`} />
                <Legend colour="#d98a2b" label={`Repaired after an edit (${repaired})`} />
                <Legend colour="var(--color-wax)" label={`Orphaned (${orphaned.length})`} />
                <span className="text-parchment-300/50">
                  {placed.length} pin{placed.length === 1 ? '' : 's'} placed
                </span>
              </div>
            </div>

            {/* Loose pins: what happens when the anchored words are deleted.
                The pin is not dropped and not silently misplaced — it keeps its
                quote and asks to be re-attached. */}
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
                        onClick={() =>
                          setPlaced((previous) => previous.filter((item) => item.id !== pin.id))
                        }
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
