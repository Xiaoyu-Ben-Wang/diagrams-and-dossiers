/**
 * The note card behind a pin.
 *
 * Opens on right-click, anchored near where the click landed. It's a popover
 * rather than a modal: you're editing one note on a board you're still looking
 * at, and covering the board to do it loses the context that made you want to
 * edit the note in the first place.
 */

import { useEffect, useRef } from 'react'

export interface PinEditorProps {
  /** The words this pin is anchored to. Read-only — edit the article to change them. */
  quote: string
  /** Whether the pin still resolves, or has gone cold. */
  status: 'exact' | 'repaired' | 'orphaned'
  dateLabel: string
  body: string
  /** Where to place it, in viewport coordinates. */
  x: number
  y: number
  onChange: (body: string) => void
  onDelete: () => void
  onClose: () => void
}

const WIDTH = 288
const ESTIMATED_HEIGHT = 240

export function PinEditor({
  quote,
  status,
  dateLabel,
  body,
  x,
  y,
  onChange,
  onDelete,
  onClose,
}: PinEditorProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  // Focus the textarea so you can start typing immediately — the point of
  // right-clicking a pin is usually to write on it.
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    textareaRef.current?.focus()
    // Put the caret at the end rather than selecting everything, so an
    // accidental keystroke appends instead of destroying the note.
    const length = textareaRef.current?.value.length ?? 0
    textareaRef.current?.setSelectionRange(length, length)
  }, [])

  // Dismiss on outside click or Escape.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!cardRef.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }

    // Deferred by a tick, or the very click that opened the editor closes it.
    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown)
    }, 0)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  // Keep the card on screen: a pin near the right or bottom edge would
  // otherwise open an editor half out of view.
  const left = Math.min(x, window.innerWidth - WIDTH - 12)
  const top = Math.min(y, window.innerHeight - ESTIMATED_HEIGHT - 12)

  return (
    <div
      ref={cardRef}
      className="fixed z-50 rounded-sm border border-parchment-edge/50 bg-parchment-100 shadow-2xl"
      style={{ left: Math.max(12, left), top: Math.max(12, top), width: WIDTH }}
      role="dialog"
      aria-label="Edit pin"
      data-testid="pin-editor"
    >
      <header className="flex items-start justify-between gap-2 border-b border-parchment-edge/50 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] text-ink-soft italic">“{quote}”</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-soft/60">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background:
                  status === 'orphaned'
                    ? 'var(--color-wax)'
                    : status === 'repaired'
                      ? '#d98a2b'
                      : 'var(--color-brass)',
              }}
            />
            {dateLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-soft/50 transition hover:text-ink"
          aria-label="Close"
        >
          ×
        </button>
      </header>

      <textarea
        ref={textareaRef}
        value={body}
        onChange={(event) => onChange(event.target.value)}
        placeholder="What do you know about this?"
        rows={6}
        className="w-full resize-none bg-transparent px-3 py-2 text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-soft/40"
        aria-label="Pin note"
      />

      <footer className="flex items-center justify-between border-t border-parchment-edge/50 px-3 py-2">
        <button
          type="button"
          onClick={onDelete}
          className="text-[11px] text-wax/80 transition hover:text-wax"
        >
          Remove pin
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-brass/60 bg-parchment-200 px-2.5 py-1 text-[11px] font-medium text-ink transition hover:bg-parchment-300"
        >
          Done
        </button>
      </footer>
    </div>
  )
}
