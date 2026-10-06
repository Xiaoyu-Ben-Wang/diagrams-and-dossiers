import { useCallback, useRef } from 'react'

import type { Point } from './yarn'

export const DRAG_THRESHOLD = 5

/** Browsers send a click after every press-release, wherever the pointer finished. */
export const CLICK_SLOP = 4

export interface BoardDragOptions {
  /** Board-space movement since the last event. */
  onDrag: (delta: Point) => void
  onDragStart?: () => void
  onTap?: () => void
  /** Screen coords, and runs before `onTap` even when the press never became a drag. */
  onEnd?: (end: { clientX: number; clientY: number; travelled: boolean }) => void
  /** Read through a ref so a mid-drag zoom stays correct. */
  zoom: number
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
  /** Where the press landed; the first drag report covers the whole travel. */
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
      // Right and middle belong to the canvas, which pans.
      if (disabled || event.button !== 0) return

      // Stop the canvas seeing this, and the press falling through to what is behind.
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

    // Screen px divided by zoom, so the object tracks the cursor at any zoom.
    const scale = zoomRef.current || 1

    if (!state.dragging) {
      if (state.travel < DRAG_THRESHOLD) return
      state.dragging = true
      startRef.current?.()
      // The whole displacement: the object must arrive under the pointer, not start behind it.
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
