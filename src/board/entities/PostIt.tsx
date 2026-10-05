import { POST_IT_WIDTH } from '../tuning'
import type { NoteEntity } from '../../model/types'
import { useBoardDrag } from '../useBoardDrag'
import type { Point } from '../yarn'

/**
 * A post-it on the board.
 *
 * Its own component because it needs a drag hook, and hooks cannot live inside
 * a `.map`. The body is edited in place — a post-it is a thing you scribble on,
 * so opening a dialog to do it would be a step backwards.
 */
export function PostIt({
  note,
  zoom,
  selected,
  onDrag,
  onChange,
  onRemove,
}: {
  note: NoteEntity
  zoom: number
  selected: boolean
  onDrag: (id: string, delta: Point) => void
  onChange: (id: string, body: string) => void
  onRemove: (id: string) => void
}) {
  const drag = useBoardDrag({
    zoom,
    onDrag: (delta) => onDrag(note.id, delta),
  })

  return (
    <div
      data-entity-id={note.id}
      data-post-it-id={note.id}
      data-board-entity="note"
      className={`post-it absolute rounded-sm p-2 ${selected ? 'is-selected' : ''}`}
      style={{
        left: note.board.x,
        top: note.board.y,
        width: POST_IT_WIDTH,
        background: note.color,
      }}
    >
      {/* The header is the grab handle, so dragging never fights with selecting
          text inside the note. */}
      <div
        {...drag}
        className="drag-bar mb-1 h-2.5 rounded-sm"
        title="Drag to move"
        aria-label="Drag post-it"
      />
      <textarea
        value={note.bodyMd}
        onChange={(event) => onChange(note.id, event.target.value)}
        placeholder="Write something…"
        className="h-24 w-full resize-none bg-transparent text-[12px] leading-snug text-ink outline-none placeholder:text-ink-soft/40"
        aria-label="Post-it note"
      />
      <button
        type="button"
        onClick={() => onRemove(note.id)}
        className="absolute top-1 right-1 text-[11px] text-ink-soft/40 transition hover:text-wax"
        aria-label="Remove post-it"
      >
        ×
      </button>
    </div>
  )
}

