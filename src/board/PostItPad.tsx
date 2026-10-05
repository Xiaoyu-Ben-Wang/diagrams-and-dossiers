/**
 * The stack of blank post-its in the corner of the board.
 *
 * Dragging off it carries a note under the pointer and drops it where it is let
 * go — the same gesture as moving a note that already exists, which is the
 * point: a palette that spawns a note at a fixed spot and leaves you to drag it
 * into place is two gestures pretending to be one.
 *
 * It sits in *viewport* space, not on the cork, so it stays in the corner
 * however the board is panned or zoomed. A palette you have to go looking for
 * is not a palette.
 *
 * The drag is tracked on the window rather than by pointer capture on the pad.
 * The note being carried is not the pad, and capture would keep every move
 * event aimed at a 60px stack in the corner; the pointer is what is moving, and
 * it will leave the pad on the first frame.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { StickyNote } from 'lucide-react'

export interface PostItPadProps {
  /**
   * Where the pointer let go, in viewport coordinates.
   *
   * Given the raw client point rather than a board point: this component has no
   * idea what the camera is doing, and the board is the only thing that does.
   */
  onDrop: (clientX: number, clientY: number) => void
  /** Whether dragging one off the pad is allowed at all. */
  disabled?: boolean
}

/** The size of the note carried under the pointer, in screen px. */
const GHOST = 84

export function PostItPad({ onDrop, disabled = false }: PostItPadProps) {
  const [carrying, setCarrying] = useState<{ x: number; y: number } | null>(null)
  const carryingRef = useRef(false)

  const start = useCallback(
    (event: React.PointerEvent) => {
      if (disabled || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      carryingRef.current = true
      setCarrying({ x: event.clientX, y: event.clientY })
    },
    [disabled],
  )

  useEffect(() => {
    if (!carrying) return

    const move = (event: PointerEvent): void => {
      if (!carryingRef.current) return
      setCarrying({ x: event.clientX, y: event.clientY })
    }
    const drop = (event: PointerEvent): void => {
      if (!carryingRef.current) return
      carryingRef.current = false
      setCarrying(null)
      // Only where there is a board underneath. Letting go over the footer is
      // letting go of nothing, and it should cost nothing.
      const canvas = document.querySelector('[data-testid="board-canvas"]')
      const box = canvas?.getBoundingClientRect()
      if (!box) return
      if (
        event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom
      ) {
        return
      }
      onDrop(event.clientX, event.clientY)
    }
    const cancel = (): void => {
      carryingRef.current = false
      setCarrying(null)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', drop)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', drop)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
    }
  }, [carrying, onDrop])

  return (
    <>
      <div
        className={`post-it-pad ${disabled ? 'is-disabled' : ''}`}
        data-testid="post-it-pad"
        role="button"
        tabIndex={0}
        aria-label="Drag onto the board to make a post-it"
        aria-disabled={disabled}
        title="Drag onto the board to make a post-it"
        onPointerDown={start}
        // The keyboard path, since a drag is not the only way to want one.
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          const canvas = document.querySelector('[data-testid="board-canvas"]')
          const box = canvas?.getBoundingClientRect()
          if (box) onDrop(box.left + box.width / 2, box.top + box.height / 2)
        }}
      >
        <StickyNote size={18} strokeWidth={1.6} aria-hidden="true" />
        <span className="post-it-pad-label">Post-its</span>
      </div>

      {/* The note under the pointer. Rendered outside the pad so it is not
          clipped by it, and fixed rather than absolute so it follows the
          pointer across the whole window rather than within the corner. */}
      {carrying ? (
        <div
          aria-hidden="true"
          className="post-it-ghost"
          style={{ left: carrying.x, top: carrying.y, width: GHOST, height: GHOST * 0.76 }}
        />
      ) : null}
    </>
  )
}
