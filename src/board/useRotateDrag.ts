/**
 * The gesture that swings a pinned sheet.
 *
 * Shared rather than written twice because a picture and a page are the same
 * interaction — grab the handle at the head of the sheet, turn it, let go — and
 * two copies of a rotation convention is two places for the sign to drift.
 *
 * The pointer is taken in *board* space through a mapping the caller supplies,
 * not measured against the handle's own bounding box. The handle rides inside
 * the sheet, so it is itself rotated; its bounding box is the axis-aligned box
 * around a turned shape and has nothing to do with where its contents are. That
 * is the one measurement that looks obvious and is quietly wrong.
 */

import { useCallback, useRef } from 'react'

import { tiltAngle, tiltTowards } from './pivot'
import type { Point } from './yarn'

export interface RotateDragOptions {
  /** The pin the sheet turns about, in board space. */
  pivot: Point
  /** The angle the sheet is at now. */
  tilt: number
  /** A viewport point in board space. */
  toBoard: (clientX: number, clientY: number) => Point
  onRotate: (degrees: number) => void
  /**
   * Called when the handle is double-clicked, instead of starting a drag.
   *
   * Two presses rather than the `dblclick` event, because this handle calls
   * `preventDefault` on `pointerdown` to keep the press from selecting text —
   * and that suppresses the compatibility mouse events, `dblclick` among them.
   * The event never arrives, so it is counted instead.
   */
  onReset?: () => void
}

/**
 * How long between two presses on a handle still counts as one gesture.
 *
 * Generous, because this is a deliberate action on a small target rather than
 * a typist's double letter.
 */
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
  /**
   * Where the handle was grabbed, and the tilt then.
   *
   * A ref rather than state: this is read and written on every pointer move,
   * and routing it through a render would lag the pointer by a frame. Holding
   * both means a drag is a *change* in angle rather than an absolute one, so
   * the sheet turns by what the hand turned and the handle stays under it.
   */
  const grabRef = useRef<{ at: number; tilt: number } | null>(null)

  // The pivot is rebuilt every render, so it is carried in a ref too — the
  // handlers below must not be rebuilt mid-gesture by a re-render.
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
  /** When the handle was last pressed, for spotting the second press. */
  const lastPressRef = useRef(0)

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return

    const now = event.timeStamp
    const since = now - lastPressRef.current
    lastPressRef.current = now
    if (onResetRef.current && since < DOUBLE_PRESS_MS) {
      // Cleared, so a third press starts a fresh drag rather than being read as
      // another double.
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
