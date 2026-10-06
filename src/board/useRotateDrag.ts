// The pointer is mapped into board space, never measured off the handle's rotated bounding box.
import { useCallback, useRef } from 'react'

import { tiltAngle, tiltTowards } from './pivot'
import type { Point } from './yarn'

export interface RotateDragOptions {
  /** In board space. */
  pivot: Point
  tilt: number
  toBoard: (clientX: number, clientY: number) => Point
  onRotate: (degrees: number) => void
  /** Counted presses, not `dblclick`: `preventDefault` on pointerdown suppresses the compatibility event. */
  onReset?: () => void
}

/** Generous: a deliberate press on a small target, not a typist's double letter. */
const DOUBLE_PRESS_MS = 400

export interface RotateDragHandlers {
  onPointerDown: (event: React.PointerEvent) => void
  onPointerMove: (event: React.PointerEvent) => void
  onPointerUp: (event: React.PointerEvent) => void
  onPointerCancel: (event: React.PointerEvent) => void
}

export function useRotateDrag({
  pivot,
  tilt,
  toBoard,
  onRotate,
  onReset,
}: RotateDragOptions): RotateDragHandlers {
  /** Grab angle and tilt together, so a drag is a change in angle, not an absolute one. */
  const grabRef = useRef<{ at: number; tilt: number } | null>(null)

  // Pivot is rebuilt every render; the ref keeps a re-render from rebuilding handlers mid-gesture.
  const pivotRef = useRef(pivot)
  pivotRef.current = pivot
  const tiltRef = useRef(tilt)
  tiltRef.current = tilt
  const toBoardRef = useRef(toBoard)
  toBoardRef.current = toBoard
  const onRotateRef = useRef(onRotate)
  onRotateRef.current = onRotate
  const onResetRef = useRef(onReset)
  onResetRef.current = onReset
  const lastPressRef = useRef(0)

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return

    const now = event.timeStamp
    const since = now - lastPressRef.current
    lastPressRef.current = now
    if (onResetRef.current && since < DOUBLE_PRESS_MS) {
      // Cleared so a third press starts a fresh drag rather than being read as another double.
      lastPressRef.current = 0
      event.stopPropagation()
      event.preventDefault()
      onResetRef.current()
      return
    }

    event.stopPropagation()
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Capture is a refinement; the drag still tracks while over the handle.
    }

    const pointer = toBoardRef.current(event.clientX, event.clientY)
    grabRef.current = { at: tiltAngle(pivotRef.current, pointer), tilt: tiltRef.current }
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const grab = grabRef.current
    if (!grab) return
    event.stopPropagation()

    const pointer = toBoardRef.current(event.clientX, event.clientY)
    onRotateRef.current(tiltTowards(pivotRef.current, pointer, grab.at, grab.tilt))
  }, [])

  const release = useCallback((event: React.PointerEvent) => {
    grabRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Already released.
    }
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp: release, onPointerCancel: release }
}
