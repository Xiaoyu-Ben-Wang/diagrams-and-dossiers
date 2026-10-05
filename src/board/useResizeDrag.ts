/**
 * Dragging the corner of a thing to change its size.
 *
 * The pointer plumbing is the same for every kind — capture, remember the size
 * you started from, compute from that on every move rather than accumulating —
 * and only the arithmetic differs. So this holds the plumbing and the caller
 * supplies `sizeAt`.
 *
 * **Computed from the start, never accumulated.** Each move recomputes the size
 * from where the drag began. Feeding the previous frame's size back in looks
 * equivalent and is not: the size is rounded to a whole number of board pixels
 * for storage, so a drag that accumulates loses up to half a pixel every frame,
 * and a slow drag over a second drifts visibly away from the cursor.
 *
 * **Measured in board space through a mapping the caller owns.** The thing
 * being resized may be rotated, and its own bounding box is then the
 * axis-aligned box around a turned shape — which has nothing to do with where
 * its corner is. That is the measurement that looks obvious and is quietly
 * wrong.
 */

import { useCallback, useRef } from 'react'

import type { Point } from './yarn'

export interface Size {
  width: number
  height: number
}

export interface ResizeDragOptions {
  /** What the thing is now. Recorded at the press and computed from after. */
  size: Size
  /** A viewport point in board space. */
  toBoard: (clientX: number, clientY: number) => Point
  /**
   * The size this drag is asking for, given the pointer and the size the thing
   * was when the drag began.
   */
  sizeAt: (pointer: Point, start: Size) => Size
  onResize: (size: Size) => void
}

export interface ResizeDragHandlers {
  onPointerDown: (event: React.PointerEvent) => void
  onPointerMove: (event: React.PointerEvent) => void
  onPointerUp: (event: React.PointerEvent) => void
  onPointerCancel: (event: React.PointerEvent) => void
}

export function useResizeDrag({
  size,
  toBoard,
  sizeAt,
  onResize,
}: ResizeDragOptions): ResizeDragHandlers {
  const startRef = useRef<Size | null>(null)

  const sizeRef = useRef(size)
  sizeRef.current = size
  const toBoardRef = useRef(toBoard)
  toBoardRef.current = toBoard
  const sizeAtRef = useRef(sizeAt)
  sizeAtRef.current = sizeAt
  const onResizeRef = useRef(onResize)
  onResizeRef.current = onResize

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return
    // Both of these matter: the press must not also select whatever is behind
    // the handle, and it must not start a drag on the thing being resized.
    event.stopPropagation()
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Capture is a refinement; the drag still tracks while over the handle.
    }

    // Taken from the caller rather than measured off the DOM. The thing being
    // resized may be rotated, and `getBoundingClientRect` on a rotated element
    // is the box around the turned shape — it would report a size the thing
    // does not have, and the drag would start from a lie.
    startRef.current = { ...sizeRef.current }
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const start = startRef.current
    if (!start) return
    event.stopPropagation()
    onResizeRef.current(sizeAtRef.current(toBoardRef.current(event.clientX, event.clientY), start))
  }, [])

  const release = useCallback((event: React.PointerEvent) => {
    startRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Already released.
    }
  }, [])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: release,
    onPointerCancel: release,
  }
}
