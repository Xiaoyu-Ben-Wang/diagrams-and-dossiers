/**
 * The page: the sheet of parchment, the article rendered on it, and everything
 * pinned through it.
 *
 * The awkward part of this component is that it holds four DOM nodes the board
 * needs to keep hold of — the paper, the article, its overlay, and the tab — so
 * the refs are passed in rather than owned here. Measurement is done against
 * those nodes by effects in `App.tsx` that have to outlive any one render, and
 * a ref that is re-created when this re-mounts is a ref that measures nothing.
 *
 * The transform on the paper is the one thing to understand before changing
 * anything: `transformOrigin: 50% 0` and a rotation about it is the pin at the
 * top-centre. Everything measured on the board rather than drawn on the sheet —
 * where a tack's string ends, where the marquee reaches — goes through
 * `articleToBoard` in `App.tsx`, which reproduces this same transform. If the
 * one changes the other has to, or a string ends somewhere its tack is not.
 */

import type { PointerEvent, MouseEvent, RefObject } from 'react'
import { RotateCw, X } from 'lucide-react'

import { ARTICLE_ID, ARTICLE_TITLE } from '../app/demo'
import { Tack } from './entities/Tack'
import type { BoardDragHandlers } from './useBoardDrag'
import { rotateAbout } from './pivot'
import { PAPER_MAX_WIDTH, PAPER_MIN_WIDTH, PAPER_WIDTH } from './tuning'
import { useResizeDrag } from './useResizeDrag'
import { useRotateDrag } from './useRotateDrag'
import type { Point } from './yarn'
import { pinPoint, type PinView } from './view'

export interface ArticleSheetProps {
  /** The sanitized article body, already rendered to HTML. */
  html: string

  /** Where the sheet sits in board space. */
  pos: Point
  /** How far it is swung about its pin, in degrees. */
  tilt: number
  /** The page's own width. Changing it reflows the article. */
  width: number
  /** Whether the page is rolled up to its tab. */
  collapsed: boolean

  paperRef: RefObject<HTMLDivElement | null>
  articleRef: RefObject<HTMLDivElement | null>
  overlayRef: RefObject<HTMLDivElement | null>

  /** Tacks through the words, already resolved to rectangles. */
  anchored: readonly PinView[]
  selected: ReadonlySet<string>
  /** The pin currently being repositioned, if any. */
  movingPin: string | null
  zoom: number

  documentSelected: boolean
  /** Props from the tab's own drag hook: it both selects and moves. */
  tabDrag: BoardDragHandlers
  /** Where the page's pin is, in board space. */
  pinAt: Point | null

  onClickArticle: (event: MouseEvent<HTMLDivElement>) => void
  onStartYarn: (event: PointerEvent, fromId: string, origin: Point | null) => void
  onMoveOne: (id: string, delta: Point) => void
  onPinDrop: (id: string, clientX: number, clientY: number) => void
  onPinHover: (pin: PinView, element: Element | null) => void
  onRotate: (degrees: number) => void
  onResize: (width: number) => void
  onToggleCollapsed: () => void
  toBoard: (clientX: number, clientY: number) => Point
  /** A point in the article's own space, in board space. */
  articleToBoard: (local: Point) => Point
}

/** The offset a tack is drawn at, relative to the words it holds. */
const TACK_DX = -6
const TACK_DY = -5

export function ArticleSheet({
  html,
  pos,
  tilt,
  width,
  collapsed,
  paperRef,
  articleRef,
  overlayRef,
  anchored,
  selected,
  movingPin,
  zoom,
  documentSelected,
  tabDrag,
  pinAt,
  onClickArticle,
  onStartYarn,
  onMoveOne,
  onPinDrop,
  onPinHover,
  onRotate,
  onResize,
  onToggleCollapsed,
  toBoard,
  articleToBoard,
}: ArticleSheetProps) {
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
  return (
    <div
      ref={paperRef}
      data-testid="paper"
      data-board-entity="article"
      className={`parchment absolute top-0 left-0 rounded-sm shadow-xl ${
        collapsed ? '' : 'px-9 py-8 sm:px-12 sm:py-10'
      } ${documentSelected ? 'ring-2 ring-brass/70' : ''}`}
      style={{
        width,
        // Rolled up, the sheet is the strip the tab is stuck to and nothing
        // else — an empty page the height of a page would read as a page whose
        // text had failed to load.
        height: collapsed ? 0 : undefined,
        transformOrigin: '50% 0',
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0) rotate(${tilt}deg)`,
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
        onPointerDown={(event) => onStartYarn(event, ARTICLE_ID, pinAt)}
      />

      {/* Only offered on a selected sheet, like a picture's. An unselected
          board is a board of things to read, not a control panel. */}
      {documentSelected ? (
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
      <button
        type="button"
        data-testid="paper-tab"
        {...tabDrag}
        aria-pressed={documentSelected}
        className={`drag-bar absolute -top-7 left-0 rounded-t px-3 py-1 text-[11px] transition ${
          documentSelected
            ? 'bg-brass/80 text-cork-900'
            : 'bg-parchment-200/85 text-ink-soft hover:bg-parchment-200'
        }`}
        title="Click to edit, drag to move"
      >
        {collapsed ? '▸ ' : '▾ '}
        {ARTICLE_TITLE}
      </button>

      {/* Closing the page rolls it up rather than deleting it: the pins
          anchored into its text have nowhere else to be, and a board where a
          stray click can orphan every note on it is a board you stop trusting.
          The tab stays, and is how it comes back. */}
      {documentSelected && !collapsed ? (
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
          ref={articleRef}
          onClick={onClickArticle}
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
                selected={selected.has(pin.id)}
                moving={movingPin === pin.id}
                zoom={zoom}
                onStartYarn={(event) => onStartYarn(event, pin.id, pinPoint(pin, articleToBoard))}
                onMove={onMoveOne}
                onDrop={onPinDrop}
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
  if (!Number.isFinite(value)) return PAPER_WIDTH
  return Math.max(PAPER_MIN_WIDTH, Math.min(PAPER_MAX_WIDTH, Math.round(value)))
}
