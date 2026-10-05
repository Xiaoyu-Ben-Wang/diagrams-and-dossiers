/**
 * One page: the sheet of parchment, the article rendered on it, and everything
 * pinned through it.
 *
 * There is one of these per `ArticleEntity`, and that is the change this
 * component is built around. It used to be a singleton whose geometry arrived
 * as loose props — `pos`, `tilt`, `width`, `collapsed` — and whose DOM was held
 * by four refs the board owned, because with one page there was exactly one of
 * each. Now the entity carries every one of those facts and the sheet reads
 * them off it, so the only thing left to hand in is the registry its elements
 * hang on: the board measures through *this* sheet's nodes, not through "the
 * paper".
 *
 * The transform on the paper is the one thing to understand before changing
 * anything: `transformOrigin: 50% 0` and a rotation about it is the pin at the
 * top-centre. Everything measured on the board rather than drawn on the sheet —
 * where a tack's string ends, where the marquee reaches — goes through
 * `articleToBoard`, which reproduces this same transform for a named article.
 * If the one changes the other has to, or a string ends somewhere its tack is
 * not.
 *
 * The sheet renders its own markdown, too. Sanitizing is per-article work — the
 * body is untrusted input and each page has its own — and doing it here means
 * an edit to one page re-parses that page and no other. It also gets the
 * memoisation for free, keyed on the one string that changed.
 */

import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import { RotateCw, X } from 'lucide-react'

import type { ArticleEntity } from '../model/types'
import { DEFAULT_ARTICLE_OPTIONS } from '../model/article-options'
import { linkifyMentions, markMissingMentions } from '../markdown/mentions'
import { Tack } from './entities/Tack'
import { CLICK_SLOP, useBoardDrag } from './useBoardDrag'
import { clampTilt, rotateAbout } from './pivot'
import { PAPER_MAX_WIDTH, PAPER_MIN_WIDTH } from './tuning'
import { useResizeDrag } from './useResizeDrag'
import { useRotateDrag } from './useRotateDrag'
import type { ArticleNodes } from './useArticleViews'
import type { Point } from './yarn'
import { pinPoint, type PinView } from './view'

export interface ArticleSheetProps {
  article: ArticleEntity
  /**
   * Where this sheet's elements are registered for measurement.
   *
   * Fill it in with the refs below and the board can find this page's paper and
   * article by id. Passing the object rather than handing back values is what
   * lets a ref survive a re-render: the registry entry is stable for the life of
   * the article, and only the nodes inside it come and go.
   */
  nodes: ArticleNodes

  /** Tacks through this page's words, already resolved against its projection. */
  anchored: readonly PinView[]
  /** Whether this *sheet* is selected — the ring and the handles, not its pins. */
  selected: boolean
  /** Everything selected on the board; a tack in these words may be in it. */
  selectedPins: ReadonlySet<string>
  /** The pin currently being repositioned, if any. */
  movingPin: string | null
  zoom: number
  /** Where the page's pin is in board space, or null until it is measured. */
  pinAt: Point | null

  /**
   * Every name a mention on this board could resolve to, lowercased.
   *
   * A set of names rather than a resolver callback: the only question asked of
   * it is whether a name is known, and a set does not change identity when an
   * unrelated entity moves.
   */
  mentionNames: ReadonlySet<string>
  onClickArticle: (event: MouseEvent<HTMLDivElement>) => void
  onStartYarn: (event: PointerEvent, fromId: string, origin: Point | null) => void
  onMoveOne: (id: string, delta: Point) => void
  onPinDrop: (id: string, clientX: number, clientY: number) => void
  /** Open a pin's editor at a point on screen — what its tag does when clicked. */
  onOpenPinEditor: (id: string, clientX: number, clientY: number) => void
  onPinHover: (pin: PinView, element: Element | null) => void
  onRotate: (degrees: number) => void
  onResize: (width: number) => void
  onToggleCollapsed: () => void
  /** A tap on the tab: opens a rolled-up page, otherwise toggles its selection. */
  onTapTab: () => void
  /** A drag of the sheet — by its tab or by its body — in board-space deltas. */
  onMove: (delta: Point) => void
  toBoard: (clientX: number, clientY: number) => Point
  /** A point in an article's own space, in board space. */
  articleToBoard: (articleId: string, local: Point) => Point | null
}

/** The offset a tack is drawn at, relative to the words it holds. */
const TACK_DX = -6
const TACK_DY = -5

export function ArticleSheet({
  article,
  nodes,
  anchored,
  selected,
  selectedPins,
  movingPin,
  zoom,
  pinAt,
  mentionNames,
  onClickArticle,
  onStartYarn,
  onMoveOne,
  onPinDrop,
  onOpenPinEditor,
  onPinHover,
  onRotate,
  onResize,
  onToggleCollapsed,
  onTapTab,
  onMove,
  toBoard,
  articleToBoard,
}: ArticleSheetProps) {
  const { board: pos, rotation: tilt, options } = article
  const width = options.width
  const collapsed = options.collapsed

  /**
   * The page's rendered body.
   *
   * Mentions are linkified here, in the same pass that produces the HTML and
   * before React commits it — the ordering is load-bearing, and `mentions.ts`
   * says why: replacing `@[Name]` with `Name` changes the text, and the anchor
   * projection measures the text that ends up on the page.
   *
   * Note what is *not* here: whether a mention resolves. That is deliberately
   * absent so the markup depends on nothing but `bodyMd`, which is what keeps
   * the projection's text nodes alive across a page being renamed, imported or
   * deleted. See the same file.
   */
  const html = useMemo(
    () =>
      linkifyMentions(DOMPurify.sanitize(marked.parse(article.bodyMd, { async: false }))),
    [article.bodyMd],
  )

  /**
   * How a mention looks when it names nothing — applied after commit, and only
   * ever as a class.
   *
   * Re-running on `html` matters: React replaces the innerHTML wholesale when
   * the body changes, so every class applied to the old nodes goes with them.
   */
  useEffect(() => {
    const element = nodes.article
    if (element) markMissingMentions(element, mentionNames)
  }, [html, mentionNames, nodes])

  const rotate = useRotateDrag({
    // The pin is the pivot, so it is the one point on the sheet that does not
    // move when the sheet turns: no tilt in this sum, deliberately.
    pivot: { x: pos.x + width / 2, y: pos.y },
    tilt,
    toBoard,
    onRotate,
    onReset: () => onRotate(0),
  })

  const resize = useResizeDrag({
    size: { width, height: 0 },
    toBoard,
    sizeAt: (pointer) => {
      // A page is resized by its width; its height is whatever the text takes.
      // Measured from the pin outward in the sheet's own frame, so a tilted
      // page grows along the direction it is actually lying in.
      const local = rotateAbout({ x: pos.x + width / 2, y: pos.y }, pointer, -tilt)
      const half = Math.abs(local.x - (pos.x + width / 2))
      return { width: clampWidth(half * 2), height: 0 }
    },
    onResize: (size) => onResize(size.width),
  })

  // The tab both selects and moves, so the hook tells them apart by travel.
  const tabDrag = useBoardDrag({ zoom, onDrag: onMove, onTap: onTapTab })

  /**
   * The whole sheet moves on a left-drag, not only its tab.
   *
   * The body is the largest thing on the board and the obvious thing to grab.
   * What it costs is drag-to-select inside a page: the press that selects a
   * passage is the same press that moves the sheet, so the drag wins once it
   * has travelled — and a selection the press had already started is dropped
   * when it does. Selecting a word (double-click), a paragraph (triple-click)
   * or a range (shift and the arrows) all still work.
   *
   * A press that does *not* travel is untouched, which is what keeps the body's
   * own gestures: click to pin a note, click a mention to fly, click a word to
   * pick up the string lying across it.
   */
  const [dragging, setDragging] = useState(false)
  /**
   * Where a drag let go, so the click the browser sends afterwards can be told
   * from a real one. See `onEnd` below and the capture handler on the sheet.
   */
  const suppressClickRef = useRef<{ x: number; y: number } | null>(null)

  const bodyDrag = useBoardDrag({
    zoom,
    onDrag: onMove,
    onDragStart: () => {
      setDragging(true)
      // The press began a selection before it was known to be a drag. Drop what
      // it selected; `data-dragging` stops it starting another.
      window.getSelection()?.removeAllRanges()
    },
    onEnd: ({ clientX, clientY, travelled }) => {
      setDragging(false)
      if (travelled) suppressClickRef.current = { x: clientX, y: clientY }
    },
  })

  /**
   * Swallow the click a drag leaves behind.
   *
   * The browser sends one after every press-release pair, landing wherever the
   * pointer finished — so a sheet dragged by its body would end with a click at
   * the drop point, and on a page a click is how a note gets pinned. Captured on
   * the sheet rather than handled on the body, because the click may be
   * retargeted to the sheet by the pointer capture, and because the body's own
   * handler must not run at all. Matched by position, like the canvas does it,
   * so a genuine click a moment later still gets through.
   */
  const swallowTrailingClick = (event: MouseEvent<HTMLDivElement>): void => {
    const swallowed = suppressClickRef.current
    if (!swallowed) return
    suppressClickRef.current = null
    const near =
      Math.abs(event.clientX - swallowed.x) <= CLICK_SLOP &&
      Math.abs(event.clientY - swallowed.y) <= CLICK_SLOP
    if (!near) return
    event.stopPropagation()
    event.preventDefault()
  }

  return (
    <div
      ref={(element) => {
        nodes.paper = element
      }}
      data-testid="paper"
      data-board-entity="article"
      // The id, so the context menu, the middle-drag and the string snap can
      // address *this* page rather than "the article". Without it the only way
      // to name a sheet was its kind, which cannot tell two of them apart.
      data-entity-id={article.id}
      // And the whole sheet's footprint, for attributing a caret: a click that
      // lands in the margin is still a click on this page, and `caretFrom`
      // walks up from the text node to find which one.
      data-article-id={article.id}
      data-dragging={dragging}
      {...bodyDrag}
      onClickCapture={swallowTrailingClick}
      className={`parchment absolute top-0 left-0 rounded-sm shadow-xl ${
        collapsed ? '' : 'px-9 py-8 sm:px-12 sm:py-10'
      } ${selected ? 'ring-2 ring-brass/70' : ''}`}
      style={{
        width,
        // Rolled up, the sheet is the strip the tab is stuck to and nothing
        // else — an empty page the height of a page would read as a page whose
        // text had failed to load.
        height: collapsed ? 0 : undefined,
        transformOrigin: '50% 0',
        // Clamped at the transform, as a picture's is. The drag already holds
        // the angle inside the limit, so this only matters for an angle that
        // did not come from a drag — a row written by something else, or a
        // limit that has since been tightened — and a sheet drawn at 90° would
        // be a page nobody could read or pin.
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0) rotate(${clampTilt(tilt)}deg)`,
      }}
    >
      {/* The pin the page hangs from, at the top-centre — the same place a
          picture is pinned, and the point everything above turns about. Drawn
          at the pivot, so it stays put when the sheet is swung, which is what
          makes the rotation legible: the page moves, the pin does not. */}
      <button
        type="button"
        data-testid="paper-pin"
        aria-label="Pin holding the page up; drag to tie a string"
        className="tack absolute h-3.5 w-3.5 cursor-crosshair rounded-full"
        style={{ left: '50%', top: 0, marginLeft: -7, marginTop: -7, touchAction: 'none' }}
        onPointerDown={(event) => onStartYarn(event, article.id, pinAt)}
      />

      {/* Only offered on a selected sheet, like a picture's. An unselected
          board is a board of things to read, not a control panel. */}
      {selected ? (
        <>
          <span
            aria-hidden="true"
            className="image-rotate-stem absolute"
            style={{ left: '50%', top: '100%', height: 16, marginLeft: -1 }}
          />
          <button
            type="button"
            data-testid="article-rotate"
            aria-label="Drag to swing the page about its pin"
            className="image-rotate absolute"
            style={{ left: '50%', top: '100%', marginTop: 16, marginLeft: -11 }}
            {...rotate}
          >
            <RotateCw size={22} strokeWidth={2.2} aria-hidden="true" />
          </button>

          {/* The right edge, which is the one dimension a page has to give:
              its height is whatever the text takes. */}
          <button
            type="button"
            data-testid="article-resize"
            aria-label="Drag to change the page width"
            className="article-resize absolute top-1/2 -right-2 -translate-y-1/2"
            {...resize}
          >
            <svg viewBox="0 0 10 24" aria-hidden="true" className="h-full w-full">
              <path
                d="M 3 4 V 20 M 7 4 V 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </>
      ) : null}

      {/* The tab is the selection affordance. Clicking the body of the paper
          pins a note; clicking the tab selects the document and opens the
          editor. Two gestures, one sheet. */}
      {/* Two controls, not one button wearing two affordances.
          The tab used to draw a caret and swallow the whole thing: the caret
          is the universal sign for "this opens something", and clicking it
          opened the editor rather than rolling the page up. The caret is its
          own target now — it rolls the page and does nothing else — and the
          title beside it is the editor trigger, which is what its tooltip has
          always said. */}
      <button
        type="button"
        data-testid="paper-disclosure"
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Open the page' : 'Roll the page up'}
        title={collapsed ? 'Open the page' : 'Roll the page up'}
        // A press here must not reach the tab's drag hook. Without this the
        // press starts a move, and a release that never travelled is a tap —
        // which opens the editor. That was the collision, in the one place it
        // was real: the caret sat inside the button that opened the editor.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onToggleCollapsed}
        data-selected={selected}
        className="paper-disclosure absolute -top-7 left-0 flex h-6 w-8 items-center justify-center rounded-tl text-[17px] leading-none"
      >
        <span aria-hidden="true" className="paper-disclosure-glyph">
          {collapsed ? '▸' : '▾'}
        </span>
      </button>

      <button
        type="button"
        data-testid="paper-tab"
        {...tabDrag}
        aria-pressed={selected}
        className={`drag-bar absolute -top-7 left-8 rounded-tr py-1 pr-3 pl-2 text-[11px] transition ${
          selected
            ? 'bg-brass/80 text-cork-900'
            : 'bg-parchment-200/85 text-ink-soft hover:bg-parchment-200'
        }`}
        title="Click to edit, drag to move"
      >
        {article.title?.trim() || 'Untitled sheet'}
      </button>

      {/* Closing the page rolls it up rather than deleting it: the pins
          anchored into its text have nowhere else to be, and a board where a
          stray click can orphan every note on it is a board you stop trusting.
          The tab stays, and is how it comes back. */}
      {selected && !collapsed ? (
        <button
          type="button"
          data-testid="paper-close"
          aria-label="Roll the page up"
          className="sheet-close"
          style={{ right: -10, top: -10 }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onToggleCollapsed}
        >
          <X size={13} strokeWidth={2.5} aria-hidden="true" />
        </button>
      ) : null}

      {collapsed ? null : (
        <div className="relative">
          <div
            ref={(element) => {
              nodes.article = element
            }}
            onClick={onClickArticle}
            className="article relative cursor-text select-text"
            dangerouslySetInnerHTML={{ __html: html }}
          />

          <div className="pointer-events-none absolute inset-0">
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
                  }}
                />
              ) : null,
            )}

            {anchored.map((pin) =>
              pin.rect ? (
                <Tack
                  key={`tack-${pin.id}`}
                  pin={pin}
                  x={pin.rect.x + pin.rect.width + TACK_DX + pin.nudge.x}
                  y={pin.rect.y + TACK_DY + pin.nudge.y}
                  selected={selectedPins.has(pin.id)}
                  moving={movingPin === pin.id}
                  zoom={zoom}
                  onStartYarn={(event) => onStartYarn(event, pin.id, pinPoint(pin, articleToBoard))}
                  onMove={onMoveOne}
                  onDrop={onPinDrop}
                  onOpenEditor={onOpenPinEditor}
                  onHover={onPinHover}
                />
              ) : null,
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ARTICLE_OPTIONS.width
  return Math.max(PAPER_MIN_WIDTH, Math.min(PAPER_MAX_WIDTH, Math.round(value)))
}
