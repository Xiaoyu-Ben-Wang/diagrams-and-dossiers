/**
 * A picture pinned to the board.
 *
 * It hangs from the tack at its top-centre and swings about it, which is why
 * the rotation is a CSS `transform-origin` of `50% 0` rather than a transform
 * worked out per frame: the browser turns the bitmap, the layout never moves,
 * and the numbers `kinds.ts` reports for hit-testing come from the same pivot
 * by the same maths in `pivot.ts`.
 *
 * The sheet is drawn at `board`, which is its top-left *before* it is turned.
 * Everything that needs to know where the picture ended up — the marquee, yarn
 * attaching to the tack, zoom-to-fit — goes through `bounds` and `anchorPoint`
 * in the registry, so this component only has to draw it.
 *
 * Nothing but the pin is drawn until the picture is selected: an unselected
 * board is a board of things to look at, and a handle on every sheet at once is
 * a control panel.
 */

import { useCallback, useRef } from 'react'

import { edgeClipPath, type EdgeStyle } from './edges'
import { clampTilt, rotateAbout } from './pivot'
import { useRotateDrag } from './useRotateDrag'
import { useBoardDrag } from './useBoardDrag'
import type { Point } from './yarn'

export interface ImageCardProps {
  id: string
  src: string
  alt?: string
  /** Top-left of the sheet before it is turned, in board space. */
  x: number
  y: number
  width: number
  height: number
  /** Degrees of swing about the top-centre pin, within ±45. */
  rotation: number
  fit: 'cover' | 'contain'
  /** How the border is damaged, from `board/edges.ts`. */
  edge: EdgeStyle
  /** The seed that damage was generated from. */
  edgeSeed: number
  selected: boolean
  /** Screen px per board px. Deltas arrive scaled and must be divided out. */
  zoom: number
  /**
   * A viewport point in board space.
   *
   * Passed in rather than derived here because the card is itself rotated, so
   * its own bounding rect is an axis-aligned box that has nothing to do with
   * where its contents are — the one measurement that would be easy to reach
   * for and quietly wrong. The camera knows the real answer.
   */
  toBoard: (clientX: number, clientY: number) => Point

  onMove: (id: string, delta: Point) => void
  onRotate: (id: string, degrees: number) => void
  onResize: (id: string, size: { width: number; height: number }) => void
  /** Start a string at this picture's pin, as a tack does. */
  onStartYarn: (event: React.PointerEvent) => void
  onSelect: (id: string) => void
}

/**
 * The picture's shadow.
 *
 * Two passes: a soft one offset downward as if the light is above the board,
 * and a tight one with no offset, which darkens the last couple of pixels
 * either side of the cut and is what makes a torn edge read as torn rather
 * than merely cut out.
 */
const SHADOW = 'drop-shadow(0 6px 9px rgb(0 0 0 / 0.55)) drop-shadow(0 1px 2px rgb(0 0 0 / 0.5))'

/**
 * How far below the sheet the rotate handle hangs, in board px.
 *
 * At the foot rather than at the head. The head is where the pin is, and a
 * control drawn beside a pin reads as part of it — the two overlap, and the one
 * you can drag is not the one that looks like a handle. A sheet also swings
 * about its pin, so its foot is the end that travels furthest: the same pull
 * moves it further and reads as a lever rather than as a nudge.
 */
const HANDLE_DROP = 16

/**
 * How small and how large a picture may be dragged, in board px.
 *
 * A floor because a picture dragged to nothing is a picture you cannot click to
 * get back; a ceiling generous enough to fill the view, because making one
 * large is a reasonable thing to want.
 */
export const MIN_EDGE = 48
export const MAX_EDGE = 1600

/**
 * How big a picture is while a corner is dragged.
 *
 * Measured in the sheet's own upright frame rather than the board's, by turning
 * the pointer back through the tilt. A tilted picture dragged by its corner
 * would otherwise grow along the board's axes and shear away from the hand.
 * The width drives and the height follows, so the proportions a photograph
 * arrived with are the proportions it keeps.
 */
export function sizeFor(
  pivot: Point,
  pointer: Point,
  rotation: number,
  start: { width: number; height: number },
): { width: number; height: number } {
  const local = rotateAbout(pivot, pointer, -rotation)
  const dx = local.x - pivot.x
  const dy = local.y - pivot.y

  // Projected onto the diagonal the corner started on, so the drag scales the
  // picture instead of shearing it. Measuring the offset on one axis alone —
  // or, worse, its absolute value — means dragging the corner *past* the pin
  // reads as a positive distance and the picture grows when it is pulled in.
  // This is signed, so it shrinks through zero and clamps there.
  const ux = start.width / 2
  const uy = start.height
  const scale = (dx * ux + dy * uy) / (ux * ux + uy * uy)

  const width = Math.max(MIN_EDGE, Math.min(MAX_EDGE, start.width * scale))
  return {
    width: Math.round(width),
    height: Math.round(width / (start.width / start.height)),
  }
}

export function ImageCard({
  id,
  src,
  alt,
  x,
  y,
  width,
  height,
  rotation,
  fit,
  selected,
  zoom,
  toBoard,
  edge,
  edgeSeed,
  onMove,
  onRotate,
  onResize,
  onSelect,
  onStartYarn,
}: ImageCardProps) {
  const pivot = { x: x + width / 2, y }

  // The stored seed, not one derived from the id: the crop is generated, and
  // generating it again is what "a fresh look each time you pick it up" means.
  const clipPath = edgeClipPath(edge, width, height, edgeSeed)

  const drag = useBoardDrag({
    zoom,
    onDrag: (delta) => onMove(id, delta),
  })

  /**
   * Selecting on the press rather than on a tap.
   *
   * A tap is a press that never travelled, so selecting there alone would mean
   * a picture could be dragged around all day without ever becoming the thing
   * that is selected — and since the rotate handle is only drawn on a selected
   * sheet, there would be no way to swing one without first letting go and
   * clicking it again. Pressing to select is also what every canvas does.
   */
  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return
      onSelect(id)
      drag.onPointerDown(event)
    },
    [drag.onPointerDown, id, onSelect],
  )

  const rotateEntityDrag = useRotateDrag({
    pivot,
    tilt: rotation,
    toBoard,
    onRotate: (degrees) => onRotate(id, degrees),
  })
  /**
   * Resizing from a corner.
   *
   * The size at the start of the drag is kept in a ref alongside the pivot, so
   * every frame computes from where the drag began rather than accumulating —
   * rounding the size each frame and feeding it back would drift.
   */
  const resizeRef = useRef<{ width: number; height: number } | null>(null)

  const startResize = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return
      event.stopPropagation()
      event.preventDefault()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Capture is a refinement; the drag still tracks while over the handle.
      }
      resizeRef.current = { width, height }
    },
    [height, width],
  )

  const moveResize = useCallback(
    (event: React.PointerEvent) => {
      const start = resizeRef.current
      if (!start) return
      event.stopPropagation()
      onResize(id, sizeFor(pivot, toBoard(event.clientX, event.clientY), rotation, start))
    },
    [id, onResize, pivot.x, pivot.y, rotation, toBoard],
  )

  const endResize = useCallback((event: React.PointerEvent) => {
    resizeRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Already released.
    }
  }, [])

  const resizeProps = {
    onPointerDown: startResize,
    onPointerMove: moveResize,
    onPointerUp: endResize,
    onPointerCancel: endResize,
  }

  const rotateProps = {
    onPointerDown: rotateEntityDrag.onPointerDown,
    onPointerMove: rotateEntityDrag.onPointerMove,
    onPointerUp: rotateEntityDrag.onPointerUp,
    onPointerCancel: rotateEntityDrag.onPointerCancel,
  }

  return (
    <div
      data-entity-id={id}
      data-image-id={id}
      className={`image-card absolute ${selected ? 'is-selected' : ''}`}
      style={{
        left: x,
        top: y,
        width,
        height,
        // The pin. Where yarn attaches, what the marquee encloses and what the
        // rotate handle turns about are all measured from this one point.
        transformOrigin: '50% 0',
        transform: `rotate(${clampTilt(rotation)}deg)`,
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
    >
      {/* The picture and its damaged border.
          Two elements, and the nesting is the point.

          The `clip-path` lives on the inner box rather than on the card,
          because a clip on the card would take the pin and the handle with it —
          the two things that must stay whole for the picture to be grabbable
          and swingable.

          The shadow lives on the outer wrapper as a `drop-shadow` filter,
          because a `box-shadow` is drawn from the element's rectangle and
          cannot know about the crop: a torn photograph sat on a perfectly
          rectangular shadow, which is the one thing that gives away that the
          edge is a mask rather than damage. `drop-shadow` applies to the
          *rendered result*, so it follows whatever silhouette the clip cut. It
          is a static filter — applied when the picture is painted, not
          animated — so the rule in docs/architecture.md about never animating
          a filter does not bite.

          The selection rim rides the same filter for the same reason: an
          `outline` is a rectangle, and a brass box drawn around a torn edge
          looks like a bug. */}
      <div
        className="image-shadow"
        style={{
          filter: selected
            ? `${SHADOW} drop-shadow(0 0 3px rgb(201 162 39 / 0.95))`
            : SHADOW,
        }}
      >
        <div className="image-frame" style={{ clipPath }}>
          <img
            src={src}
            alt={alt ?? ''}
            draggable={false}
            className="pointer-events-none h-full w-full select-none"
            style={{ objectFit: fit }}
          />
        </div>
      </div>

      {/* The tack holding it up, drawn where the registry says the anchor is —
          so a string tied to this picture visibly ends on its pin rather than
          at the sheet's corner.

          A button, not a decoration: this is the one part of a picture that is
          the pin rather than the paper, so it is where a string starts, the
          same gesture a tack takes. It sits at the pivot, so it does not move
          when the sheet swings and stays a fixed target to aim at. */}
      <button
        type="button"
        data-testid="image-pin"
        aria-label={`Pin holding ${alt || 'a picture'} up; drag to tie a string`}
        className="tack absolute h-3.5 w-3.5 cursor-crosshair rounded-full"
        style={{ left: '50%', top: 0, marginLeft: -7, marginTop: -7, touchAction: 'none' }}
        onPointerDown={onStartYarn}
      />

      {selected ? (
        <>
          <span
            aria-hidden="true"
            className="image-rotate-stem absolute"
            style={{ left: '50%', top: '100%', height: HANDLE_DROP, marginLeft: -1 }}
          />
          <button
            type="button"
            data-testid="image-resize"
            aria-label="Drag to resize the picture"
            className="image-resize absolute"
            style={{ right: -9, bottom: -9 }}
            {...resizeProps}
          >
            <svg viewBox="0 0 18 18" aria-hidden="true" className="h-full w-full">
              <path
                d="M 15.5 6.5 V 15.5 H 6.5 M 15.5 11 V 15.5 H 11"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <button
            type="button"
            data-testid="image-rotate"
            aria-label="Drag to swing the picture about its pin"
            className="image-rotate absolute"
            style={{ left: '50%', top: '100%', marginTop: HANDLE_DROP, marginLeft: -11 }}
            {...rotateProps}
          >
            <svg viewBox="0 0 22 22" aria-hidden="true" className="h-full w-full">
              <path
                d="M 4.2 11.4 A 6.8 6.8 0 1 1 8.4 17.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <path
                d="M 1.4 7.6 L 4.4 11.9 L 8.8 9.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </>
      ) : null}
    </div>
  )
}
