// The drag is tracked on the window, not by pointer capture on the pad: capture would aim
// every move event at the 60px pad while the pointer is somewhere else entirely.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { DRAG_THRESHOLD } from './useBoardDrag'

export interface PalettePadProps {
  label: string
  icon: ReactNode
  ghost: (at: { x: number; y: number }) => ReactNode
  onDrop: (clientX: number, clientY: number) => void
  disabled?: boolean
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
  // A press that never travels is a click on the pad; without this a stray click leaves a
  // thing under the pad, which then swallows every press on that corner.
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
      if (!travelled) return

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

      {carrying ? ghost(carrying) : null}
    </>
  )
}

export interface BoardPaletteProps {
  onDropNote: (clientX: number, clientY: number) => void
  onDropPin: (clientX: number, clientY: number) => void
  canCreate: boolean
}

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

function PinGlyph() {
  return <span className="palette-glyph-tack" />
}

function NoteGlyph() {
  return <span className="palette-glyph-note" />
}
