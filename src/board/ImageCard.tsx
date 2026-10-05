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
 */

import { useCallback } from 'react'

import { clampTilt } from './pivot'
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
  /** Start a string at this picture's pin, as a tack does. */
  onStartYarn: (event: React.PointerEvent) => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

/** How far above the tack the rotate handle sits, in board px. */
const HANDLE_REACH = 34

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
  onMove,
  onRotate,
  onSelect,
  onRemove,
  onStartYarn,
}: ImageCardProps) {
  const pivot = { x: x + width / 2, y }

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
      <img
        src={src}
        alt={alt ?? ''}
        draggable={false}
        className="pointer-events-none h-full w-full select-none"
        style={{ objectFit: fit }}
      />

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
            style={{ left: '50%', top: -HANDLE_REACH, height: HANDLE_REACH + 2, marginLeft: -1 }}
          />
          <button
            type="button"
            data-testid="image-rotate"
            aria-label="Drag to swing the picture about its pin"
            className="image-rotate absolute"
            style={{ left: '50%', top: -HANDLE_REACH, marginLeft: -11 }}
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

          <button
            type="button"
            aria-label="Remove picture"
            className="image-remove absolute -top-2 -right-2 h-5 w-5 rounded-full"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onRemove(id)}
          >
            ×
          </button>
        </>
      ) : null}
    </div>
  )
}
