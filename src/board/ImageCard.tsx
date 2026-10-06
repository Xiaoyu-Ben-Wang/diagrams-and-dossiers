// The rotation is a CSS `transform-origin` of `50% 0`, the top-centre pin; `kinds.ts` reports
// hit-testing numbers from the same pivot by the same maths in `pivot.ts`.

import { useCallback } from 'react'

import { edgeClipPath, type EdgeStyle } from './edges'
import { IMAGE_PIN_INSET } from '../model/kinds'
import { clampTilt, rotateAbout } from './pivot'
import { useResizeDrag } from './useResizeDrag'
import { useRotateDrag } from './useRotateDrag'
import { useBoardDrag } from './useBoardDrag'
import type { Point } from './yarn'

export interface ImageCardProps {
  id: string
  src: string
  alt?: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  fit: 'cover' | 'contain'
  edge: EdgeStyle
  edgeSeed: number
  selected: boolean
  zoom: number
  // Passed in, not derived: the card is rotated, so its own bounding rect is axis-aligned and
  // says nothing about where its contents are.
  toBoard: (clientX: number, clientY: number) => Point

  onMove: (id: string, delta: Point) => void
  onRotate: (id: string, degrees: number) => void
  onResize: (id: string, size: { width: number; height: number }) => void
  onStartYarn: (event: React.PointerEvent) => void
  onSelect: (id: string) => void
}

// Exported for the image export: a picture's selection rim is an inline filter on top of this
// one, so a clone cannot be cleaned up by stripping a class.
export const SHADOW = 'drop-shadow(0 6px 9px rgb(0 0 0 / 0.55)) drop-shadow(0 1px 2px rgb(0 0 0 / 0.5))'

const HANDLE_DROP = 16

export const MIN_EDGE = 48
export const MAX_EDGE = 1600

export function sizeFor(
  pivot: Point,
  pointer: Point,
  rotation: number,
  start: { width: number; height: number },
): { width: number; height: number } {
  const local = rotateAbout(pivot, pointer, -rotation)
  const dx = local.x - pivot.x
  const dy = local.y - pivot.y

  // Projected onto the diagonal the corner started on, and signed, so the drag scales the
  // picture rather than shearing it and shrinks through zero instead of growing when pulled in.
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

  const clipPath = edgeClipPath(edge, width, height, edgeSeed)

  const drag = useBoardDrag({
    zoom,
    onDrag: (delta) => onMove(id, delta),
  })

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
    onReset: () => onRotate(id, 0),
  })
  const resizeProps = useResizeDrag({
    size: { width, height },
    toBoard,
    sizeAt: (pointer, start) => sizeFor(pivot, pointer, rotation, start),
    onResize: (size) => onResize(id, size),
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
      data-board-entity="image"
      className={`image-card absolute ${selected ? 'is-selected' : ''}`}
      style={{
        left: x,
        top: y,
        width,
        height,
        transformOrigin: '50% 0',
        transform: `rotate(${clampTilt(rotation)}deg)`,
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
    >
      {/* The clip is on the inner box, or it would take the pin and the handle with it; the
          shadow is on the outer wrapper as a `drop-shadow` so it follows the clipped
          silhouette rather than the rectangle. */}
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

      {/* `IMAGE_PIN_INSET` from the top edge, the same number `model/kinds.ts` uses for the
          anchor — a pin drawn in one place and reported in another is a string that misses its tack. */}
      <button
        type="button"
        data-testid="image-pin"
        aria-label={`Pin holding ${alt || 'a picture'} up; drag to tie a string`}
        className="tack absolute h-3.5 w-3.5 cursor-crosshair rounded-full"
        style={{
          left: '50%',
          top: IMAGE_PIN_INSET,
          marginLeft: -7,
          marginTop: -7,
          touchAction: 'none',
        }}
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
