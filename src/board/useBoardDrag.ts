/**
 * Dragging a board object — the article, a post-it.
 *
 * Two things make this more than a pointermove handler:
 *
 *  1. **Deltas are in screen pixels and the object lives in board space.** At
 *     2× zoom, dragging the mouse 100px must move the object 50 board px or it
 *     runs away from the cursor. The delta is divided by zoom.
 *  2. **A press that doesn't move is a click.** The same gesture selects an
 *     object and drags it, so they're told apart by travel rather than by which
 *     button or where you grabbed. A move threshold checked per-frame would miss
 *     slow drags that never exceed it in one step, so travel accumulates.
 *
 * Deltas are reported incrementally rather than as an absolute position: the
 * caller owns the object's coordinates and may be moving several objects at once
 * (a selection), which an absolute position cannot express.
 */

import { useCallback, useRef } from 'react'

import type { Point } from './yarn'

/** Pointer travel, in pixels, above which a press is a drag rather than a click. */
export const DRAG_THRESHOLD = 5

export interface BoardDragOptions {
  /** Called with board-space movement since the last event. */
  onDrag: (delta: Point) => void
  /** Called on release if the pointer never travelled far enough to be a drag. */
  onTap?: () => void
  /** Current camera zoom. Read through a ref, so a zoom mid-drag stays correct. */
  zoom: number
  /** Blocks the drag entirely — e.g. an object that is mid-edit. */
  disabled?: boolean
}

export interface BoardDragHandlers {
  onPointerDown: (event: React.PointerEvent) => void
  onPointerMove: (event: React.PointerEvent) => void
  onPointerUp: (event: React.PointerEvent) => void
  onPointerCancel: (event: React.PointerEvent) => void
}

interface DragState {
  pointerId: number
  lastX: number
  lastY: number
  travel: number
}

export function useBoardDrag({
  onDrag,
  onTap,
  zoom,
  disabled = false,
}: BoardDragOptions): BoardDragHandlers {
  const stateRef = useRef<DragState | null>(null)

  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  const dragRef = useRef(onDrag)
  dragRef.current = onDrag
  const tapRef = useRef(onTap)
  tapRef.current = onTap

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Left button only. Right and middle belong to the canvas, which pans.
      if (disabled || event.button !== 0) return

      // Stop the canvas from also seeing this, and stop the press from falling
      // through to whatever is behind the object.
      event.stopPropagation()

      stateRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        travel: 0,
      }

      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Capture is a refinement; the drag still tracks while over the object.
      }
    },
    [disabled],
  )

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const state = stateRef.current
    if (!state || state.pointerId !== event.pointerId) return

    const dx = event.clientX - state.lastX
    const dy = event.clientY - state.lastY
    state.travel += Math.abs(dx) + Math.abs(dy)
    state.lastX = event.clientX
    state.lastY = event.clientY

    const scale = zoomRef.current || 1
    dragRef.current({ x: dx / scale, y: dy / scale })
  }, [])

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    const state = stateRef.current
    if (!state || state.pointerId !== event.pointerId) return

    stateRef.current = null
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Already released.
    }

    if (state.travel < DRAG_THRESHOLD) tapRef.current?.()
  }, [])

  const onPointerCancel = useCallback((event: React.PointerEvent) => {
    const state = stateRef.current
    if (state && state.pointerId === event.pointerId) stateRef.current = null
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}
