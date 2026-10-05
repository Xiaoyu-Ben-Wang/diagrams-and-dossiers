/**
 * A post-it on the board.
 *
 * The body is edited in place — a post-it is a thing you scribble on, so
 * opening a dialog to do it would be a step backwards — and the header is the
 * grab handle, so dragging never fights with selecting text inside the note.
 *
 * Its size is its own rather than the board's: a note is as big as what is
 * written on it, so the corner drags. Freely, not proportionally — unlike a
 * photograph, there is no shape a note is supposed to be, and a note stretched
 * to fit a sentence is the point.
 *
 * Laid out as a column — header, then body filling what is left — rather than
 * with a computed height for the textarea. The body's height is whatever is
 * over once the header and the padding have taken theirs, which is a thing
 * flex knows and arithmetic has to be told again every time the padding
 * changes.
 */

import { X } from 'lucide-react'

import type { NoteEntity } from '../../model/types'
import { useBoardDrag } from '../useBoardDrag'
import { useResizeDrag } from '../useResizeDrag'
import type { Point } from '../yarn'

/** How small and how large a note may be dragged, in board px. */
const MIN_WIDTH = 96
const MIN_HEIGHT = 80
const MAX_EDGE = 900

export interface PostItProps {
  note: NoteEntity
  zoom: number
  selected: boolean
  /** A viewport point in board space, for measuring the corner drag. */
  toBoard: (clientX: number, clientY: number) => Point
  onSelect: (id: string) => void
  onDrag: (id: string, delta: Point) => void
  onChange: (id: string, body: string) => void
  onResize: (id: string, size: { width: number; height: number }) => void
  onRemove: (id: string) => void
}

export function PostIt({
  note,
  zoom,
  selected,
  toBoard,
  onSelect,
  onDrag,
  onChange,
  onResize,
  onRemove,
}: PostItProps) {
  const drag = useBoardDrag({
    zoom,
    onDrag: (delta) => onDrag(note.id, delta),
  })

  const resize = useResizeDrag({
    size: { width: note.width, height: note.height },
    toBoard,
    sizeAt: (pointer) => {
      // Measured from the note's own corner in board space, which is correct
      // here only because a note is never rotated. A tilted sheet would have to
      // turn the pointer back through its own angle first, the way a picture
      // does.
      return {
        width: clamp(pointer.x - note.board.x, MIN_WIDTH, MAX_EDGE),
        height: clamp(pointer.y - note.board.y, MIN_HEIGHT, MAX_EDGE),
      }
    },
    onResize: (size) => onResize(note.id, size),
  })

  return (
    <div
      data-entity-id={note.id}
      data-post-it-id={note.id}
      data-board-entity="note"
      // Selecting on the press, not on a tap: the resize corner is only drawn
      // on a selected note, so a tap that travelled would move a note and never
      // select it, and there would be no way to reach the corner at all.
      // Nothing calls preventDefault, so a press in the body still lands in the
      // textarea and puts the caret where it was aimed.
      onPointerDown={() => onSelect(note.id)}
      className={`post-it absolute flex flex-col rounded-sm p-2 ${
        selected ? 'is-selected' : ''
      }`}
      style={{
        left: note.board.x,
        top: note.board.y,
        width: note.width,
        height: note.height,
        background: note.color,
      }}
    >
      {/* The header is the grab handle, so dragging never fights with selecting
          text inside the note. The close button rides on it rather than in the
          corner, where it would sit under the resize handle. */}
      <div className="mb-1 flex h-3 shrink-0 items-center gap-1">
        <div
          {...drag}
          className="drag-bar h-full flex-1 rounded-sm"
          title="Drag to move"
          aria-label="Drag post-it"
        />
        <button
          type="button"
          aria-label="Remove post-it"
          className="post-it-close"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onRemove(note.id)}
        >
          <X size={11} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>

      <textarea
        value={note.bodyMd}
        onChange={(event) => onChange(note.id, event.target.value)}
        placeholder="Write something…"
        className="min-h-0 w-full flex-1 resize-none bg-transparent text-[12px] leading-snug text-ink outline-none placeholder:text-ink-soft/40"
        aria-label="Post-it note"
      />

      {/* The corner. Drawn only while the note is selected, like a picture's —
          an unselected board is a board of things to read, not a control
          panel. */}
      {selected ? (
        <button
          type="button"
          data-testid="post-it-resize"
          aria-label="Drag to resize the note"
          className="post-it-resize absolute -right-1 -bottom-1"
          {...resize}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" className="h-full w-full">
            <path
              d="M 10.5 4 V 10.5 H 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  )
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low
  return Math.max(low, Math.min(high, Math.round(value)))
}
