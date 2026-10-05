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
 *
 * Nothing is reported until the press has travelled far enough to be a drag, and
 * the first report is everything travelled so far. Reporting the sub-threshold
 * pixels would mean a plain click nudging the object by however much the mouse
 * twitched with the button down — which nobody notices on a post-it and
 * everybody notices on a page, whose body is also the thing you click to pin a
 * note to it.
 */

import { useCallback, useRef } from 'react'

import type { Point } from './yarn'

/** Pointer travel, in pixels, above which a press is a drag rather than a click. */
export const DRAG_THRESHOLD = 5

/**
 * How far a click may land from where a drag ended and still count as that
 * drag's trailing click rather than a new one.
 *
 * Browsers send a click after every press-release pair, drag or not, and they
 * report it wherever the pointer finished. Matching on position is what lets
 * something swallow its own trailing click without also eating a real one a
 * moment later somewhere else. Shared with `BoardCanvas`, which does the same
 * thing for a rubber band — the two gestures differ, the browser's behaviour
 * does not.
 */
export const CLICK_SLOP = 4

export interface BoardDragOptions {
  /** Called with board-space movement since the last event. */
  onDrag: (delta: Point) => void
  /**
   * Called once, on the move that turns the press into a drag.
   *
   * A drag is also the moment to deal with whatever the press began as: a press
   * on a page starts a text selection before anyone knows whether it will be a
   * drag, and the selection has to go when it turns out to be one.
   */
  onDragStart?: () => void
  /** Called on release if the pointer never travelled far enough to be a drag. */
  onTap?: () => void
  /**
   * Called on release, once the drag is over, with where the pointer finished.
   *
   * Screen coordinates rather than a board delta, because what a drop usually
   * needs is to ask what is *under* it — which is a question about the DOM, and
   * the DOM does not know about board space. Runs before `onTap`, so a release
   * that never travelled far enough to be a drag sees this too.
   */
  onEnd?: (end: { clientX: number; clientY: number; travelled: boolean }) => void
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
  /** Where the press landed, so the first report can cover the whole travel. */
  startX: number
  startY: number
  travel: number
  dragging: boolean
}

export function useBoardDrag({
  onDrag,
  onDragStart,
  onTap,
  onEnd,
  zoom,
  disabled = false,
}: BoardDragOptions): BoardDragHandlers {
  const stateRef = useRef<DragState | null>(null)

  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  const dragRef = useRef(onDrag)
  dragRef.current = onDrag
  const startRef = useRef(onDragStart)
  startRef.current = onDragStart
  const tapRef = useRef(onTap)
  tapRef.current = onTap
  const endRef = useRef(onEnd)
  endRef.current = onEnd

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
        startX: event.clientX,
        startY: event.clientY,
        travel: 0,
        dragging: false,
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

    if (!state.dragging) {
      if (state.travel < DRAG_THRESHOLD) return
      state.dragging = true
      startRef.current?.()
      // The whole displacement, not this event's: the object has been still
      // while the pointer moved five pixels, and it has to arrive under the
      // pointer rather than start five pixels behind it.
      dragRef.current({
        x: (event.clientX - state.startX) / scale,
        y: (event.clientY - state.startY) / scale,
      })
      return
    }

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

    const travelled = state.travel >= DRAG_THRESHOLD
    endRef.current?.({ clientX: event.clientX, clientY: event.clientY, travelled })
    if (!travelled) tapRef.current?.()
  }, [])

  const onPointerCancel = useCallback((event: React.PointerEvent) => {
    const state = stateRef.current
    if (state && state.pointerId === event.pointerId) stateRef.current = null
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}
