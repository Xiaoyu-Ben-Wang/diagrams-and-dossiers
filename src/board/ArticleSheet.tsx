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

import { ARTICLE_ID, ARTICLE_TITLE } from '../app/demo'
import { Tack } from './entities/Tack'
import type { BoardDragHandlers } from './useBoardDrag'
import { ArticleRotateHandle } from './entities/ArticleRotateHandle'
import { PAPER_WIDTH } from './tuning'
import type { Point } from './yarn'
import { pinPoint, type PinView } from './view'

export interface ArticleSheetProps {
  /** The sanitized article body, already rendered to HTML. */
  html: string

  /** Where the sheet sits in board space. */
  pos: Point
  /** How far it is swung about its pin, in degrees. */
  tilt: number

  paperRef: RefObject<HTMLDivElement | null>
  articleRef: RefObject<HTMLDivElement | null>
  overlayRef: RefObject<HTMLDivElement | null>

  /** Tacks through the words, already resolved to rectangles. */
  anchored: readonly PinView[]
  selected: ReadonlySet<string>
  /** Whether the timeline is holding anything back right now. */
  dimming: boolean
  /** Ids the timeline considers current, so dimming can spare them. */
  activeIds: ReadonlySet<string>
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
  paperRef,
  articleRef,
  overlayRef,
  anchored,
  selected,
  dimming,
  activeIds,
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
  toBoard,
  articleToBoard,
}: ArticleSheetProps) {
  return (
    <div
      ref={paperRef}
      data-testid="paper"
      data-board-entity="article"
      className={`parchment absolute top-0 left-0 rounded-sm px-9 py-8 shadow-xl sm:px-12 sm:py-10 ${
        documentSelected ? 'ring-2 ring-brass/70' : ''
      }`}
      style={{
        width: PAPER_WIDTH,
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
        <ArticleRotateHandle
          tilt={tilt}
          // The pin is the pivot, so it is the one point on the sheet that does
          // not move when the sheet turns: no tilt in this sum, deliberately.
          pivot={{ x: pos.x + PAPER_WIDTH / 2, y: pos.y }}
          toBoard={toBoard}
          onRotate={onRotate}
        />
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
        {documentSelected ? '▾ ' : '▸ '}
        {ARTICLE_TITLE}
      </button>

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
                  opacity: !dimming || activeIds.has(pin.id) ? 1 : 0.16,
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
                dimmed={dimming && !activeIds.has(pin.id)}
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
    </div>
  )
}
