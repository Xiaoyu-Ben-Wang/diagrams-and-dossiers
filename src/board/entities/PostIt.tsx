import { RotateCcw, X } from "lucide-react";

import {
  NOTE_FONT_SCALE_DEFAULT,
  NOTE_FONT_SCALE_MAX,
  NOTE_FONT_SCALE_MIN,
  NOTE_FONT_SIZE,
  noteLineRatio,
  stepFontScale,
} from "../../model/kinds";
import type { CSSProperties } from "react";

import type { NoteEntity } from "../../model/types";
import { useBoardDrag } from "../useBoardDrag";
import { useResizeDrag } from "../useResizeDrag";
import type { Point } from "../yarn";

const MIN_WIDTH = 96;
const MIN_HEIGHT = 80;
const MAX_EDGE = 900;

/** The note's padding plus the header row, above the first line of writing. */
const TEXT_TOP = 8 + 12 + 4;

export interface PostItProps {
  note: NoteEntity;
  zoom: number;
  selected: boolean;
  toBoard: (clientX: number, clientY: number) => Point;
  onSelect: (id: string) => void;
  onDrag: (id: string, delta: Point) => void;
  onChange: (id: string, body: string) => void;
  onResize: (id: string, size: { width: number; height: number }) => void;
  onSetFontScale: (id: string, scale: number) => void;
  onOpenStyleMenu: (id: string) => void;
  styleMenuOpen: boolean;
  onRemove: (id: string) => void;
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
  onSetFontScale,
  onOpenStyleMenu,
  styleMenuOpen,
  onRemove,
}: PostItProps) {
  const drag = useBoardDrag({
    zoom,
    onDrag: (delta) => onDrag(note.id, delta),
  });

  const lineHeight = NOTE_FONT_SIZE * note.fontScale * noteLineRatio(note.font);

  const resize = useResizeDrag({
    size: { width: note.width, height: note.height },
    toBoard,
    sizeAt: (pointer) => {
      // Measured from the corner in board space; correct only because a note is never rotated —
      // a tilted one would have to un-rotate the pointer first, as a picture does.
      return {
        width: clamp(pointer.x - note.board.x, MIN_WIDTH, MAX_EDGE),
        height: clamp(pointer.y - note.board.y, MIN_HEIGHT, MAX_EDGE),
      };
    },
    onResize: (size) => onResize(note.id, size),
  });

  return (
    <div
      data-entity-id={note.id}
      data-post-it-id={note.id}
      data-board-entity="note"
      data-note-style={note.style}
      data-note-font={note.font}
      // Select on the press, not a tap: the resize corner is only drawn on a selected note, so
      // a tap that travelled could move it and never select it, never reaching the corner.
      onPointerDown={() => onSelect(note.id)}
      className={`post-it absolute flex flex-col rounded-sm p-2 ${
        selected ? "is-selected" : ""
      }`}
      style={
        {
          left: note.board.x,
          top: note.board.y,
          width: note.width,
          height: note.height,
          // The note's own lean. Stored on the entity, not taken from its place in
          // the layer, so adding or removing a note does not re-tilt the others.
          transform: `rotate(${note.tilt}deg)`,
          // Longhand, not `background`: the shorthand resets `background-image`, and
          // an inline style outranks the stylesheet, so every paper style would be
          // wiped. See `[data-note-style]` in index.css. Crumpled leaves it unset —
          // its paper is the shaded `::before`, and the note itself is see-through.
          backgroundColor: note.color,
          // The ruled and grid papers draw at the text's own pitch, which is the one
          // thing a constant cannot know.
          "--note-line": `${lineHeight}px`,
          "--note-line-start": `${TEXT_TOP}px`,
        } as CSSProperties
      }
    >
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
        className="min-h-0 w-full flex-1 resize-none bg-transparent text-ink outline-none placeholder:text-ink-soft/40"
        style={{
          fontSize: NOTE_FONT_SIZE * note.fontScale,
          lineHeight: `${lineHeight}px`,
        }}
        aria-label="Post-it note"
      />

      {selected ? (
        <div className="post-it-tools">
          <button
            type="button"
            data-testid="post-it-style"
            data-note-style-menu-trigger
            aria-label="Style and colour"
            aria-haspopup="true"
            aria-expanded={styleMenuOpen}
            title="Paper and colour"
            className="post-it-style"
            data-selected={styleMenuOpen}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onOpenStyleMenu(note.id)}
          >
            <span
              aria-hidden="true"
              className="post-it-style-chip"
              data-note-style={note.style}
              style={{ backgroundColor: note.color }}
            />
          </button>

          <div className="post-it-fonts">
            <button
              type="button"
              data-testid="post-it-font-down"
              aria-label="Smaller writing"
              title="Smaller writing"
              className="post-it-font"
              disabled={note.fontScale <= NOTE_FONT_SCALE_MIN}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() =>
                onSetFontScale(note.id, stepFontScale(note.fontScale, -1))
              }
            >
              <span
                className="post-it-font-a"
                style={{ fontSize: 9 }}
                aria-hidden="true"
              >
                A
              </span>
            </button>
            <button
              type="button"
              data-testid="post-it-font-up"
              aria-label="Larger writing"
              title="Larger writing"
              className="post-it-font"
              disabled={note.fontScale >= NOTE_FONT_SCALE_MAX}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() =>
                onSetFontScale(note.id, stepFontScale(note.fontScale, 1))
              }
            >
              <span
                className="post-it-font-a"
                style={{ fontSize: 14 }}
                aria-hidden="true"
              >
                A
              </span>
            </button>
            <button
              type="button"
              data-testid="post-it-font-reset"
              aria-label="Reset writing size"
              title="Back to the normal size"
              className="post-it-font"
              disabled={note.fontScale === NOTE_FONT_SCALE_DEFAULT}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onSetFontScale(note.id, NOTE_FONT_SCALE_DEFAULT)}
            >
              <RotateCcw size={11} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

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
  );
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.max(low, Math.min(high, Math.round(value)));
}
