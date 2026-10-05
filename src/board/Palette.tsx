/**
 * The supplies in the corner of the board: a stack of blank post-its and a
 * pile of loose tacks.
 *
 * Both work the same way — press, drag, let go — and both drop what they carry
 * where the pointer was. That is the point of having them: a palette that
 * spawns a thing at a fixed spot and leaves you to drag it into place is two
 * gestures pretending to be one.
 *
 * They sit in *viewport* space, not on the cork, so they stay in the corner
 * however the board is panned or zoomed. A palette you have to go looking for
 * is not a palette.
 *
 * One component for both, because they differ only in what they carry: the
 * drag, the travel threshold, the ghost, and the refusal to drop off the board
 * are the same for a note as for a tack. Nothing here knows what a post-it is.
 *
 * The drag is tracked on the window rather than by pointer capture on the pad.
 * The thing being carried is not the pad, and capture would keep every move
 * event aimed at a 60px stack in the corner while the pointer is somewhere else
 * entirely.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { DRAG_THRESHOLD } from './useBoardDrag'

export interface PalettePadProps {
  /** What is on the label, under the stack. */
  label: string
  /** The glyph drawn on the top sheet. */
  icon: ReactNode
  /**
   * What is carried under the pointer, given where the pointer is.
   *
   * A function rather than a node because the position changes every frame and
   * this is the only thing that knows it.
   */
  ghost: (at: { x: number; y: number }) => ReactNode
  /**
   * Where the pointer let go, in viewport coordinates.
   *
   * Client coordinates rather than a board point: this has no idea what the
   * camera is doing, and the board is the only thing that does.
   */
  onDrop: (clientX: number, clientY: number) => void
  /** Whether taking one is allowed at all. */
  disabled?: boolean
  /** Which slot in the row, for the entrance stagger. */
  index?: number
}

export function PalettePad({
  label,
  icon,
  ghost,
  onDrop,
  disabled = false,
  index = 0,
}: PalettePadProps) {
  const [carrying, setCarrying] = useState<{ x: number; y: number } | null>(null)
  const carryingRef = useRef(false)
  /**
   * How far the pointer has moved since the press.
   *
   * A press that never travels is a click on the pad, not something carried off
   * it. Without this a stray click leaves a thing *under* the pad — and worse,
   * the pad swallows every press on that corner of the board, so the cork it
   * covers can no longer be clicked at all.
   */
  const travelRef = useRef(0)

  const start = useCallback(
    (event: React.PointerEvent) => {
      if (disabled || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      carryingRef.current = true
      travelRef.current = 0
      setCarrying({ x: event.clientX, y: event.clientY })
    },
    [disabled],
  )

  useEffect(() => {
    if (!carrying) return

    const move = (event: PointerEvent): void => {
      if (!carryingRef.current) return
      setCarrying((previous) => {
        if (previous) {
          travelRef.current +=
            Math.abs(event.clientX - previous.x) + Math.abs(event.clientY - previous.y)
        }
        return { x: event.clientX, y: event.clientY }
      })
    }

    const drop = (event: PointerEvent): void => {
      if (!carryingRef.current) return
      carryingRef.current = false
      const travelled = travelRef.current >= DRAG_THRESHOLD
      setCarrying(null)
      // Never moved, so nothing was carried anywhere.
      if (!travelled) return

      // Only where there is a board underneath. Letting go over the footer is
      // letting go of nothing, and it should cost nothing.
      const box = document.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect()
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
        className={`palette-pad palette-pad-${index} ${disabled ? 'is-disabled' : ''}`}
        data-testid={`palette-pad-${index}`}
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-disabled={disabled}
        title={label}
        onPointerDown={start}
        // The keyboard path, since a drag is not the only way to want one.
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          const box = document.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect()
          if (box) onDrop(box.left + box.width / 2, box.top + box.height / 2)
        }}
      >
        <span className="palette-pad-sheet" aria-hidden="true">
          {icon}
        </span>
        <span className="palette-pad-label">{label}</span>
      </div>

      {/* Carried outside the pad so it is not clipped by it, and fixed rather
          than absolute so it follows the pointer across the whole window. */}
      {carrying ? ghost(carrying) : null}
    </>
  )
}

export interface BoardPaletteProps {
  /** Take a post-it off the pad and put it down here. */
  onDropNote: (clientX: number, clientY: number) => void
  /** Take a tack off the pile and push it in here. */
  onDropPin: (clientX: number, clientY: number) => void
  canCreate: boolean
}

/**
 * The two pads, side by side in the corner of the board.
 *
 * Side by side rather than stacked because they are alternatives, not a
 * sequence: you reach for one or the other, and a column would make the lower
 * one read as the next step after the upper.
 */
export function BoardPalette({ onDropNote, onDropPin, canCreate }: BoardPaletteProps) {
  return (
    <div className="palette" data-testid="board-palette">
      <PalettePad
        index={0}
        label="Drag onto the board to pin something"
        disabled={!canCreate}
        icon={<PinGlyph />}
        ghost={(at) => <span className="palette-ghost-tack" style={{ left: at.x, top: at.y }} />}
        onDrop={onDropPin}
      />
      <PalettePad
        index={1}
        label="Drag onto the board to make a post-it"
        disabled={!canCreate}
        icon={<NoteGlyph />}
        ghost={(at) => (
          <span className="palette-ghost-note" style={{ left: at.x, top: at.y }} />
        )}
        onDrop={onDropNote}
      />
    </div>
  )
}

/**
 * The glyphs, drawn here rather than taken from the icon set.
 *
 * Both objects already exist on this board and are drawn elsewhere — a tack is
 * a radial gradient, and a post-it is a rectangle of parchment. An icon from a
 * set would be a third drawing of the same two things, in a stroke weight
 * nothing else uses.
 */
function PinGlyph() {
  return <span className="palette-glyph-tack" />
}

function NoteGlyph() {
  return <span className="palette-glyph-note" />
}
