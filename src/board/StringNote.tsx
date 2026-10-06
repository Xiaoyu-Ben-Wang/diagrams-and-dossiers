// The slide projects the pointer onto the curve rather than applying a delta, which would
// accumulate off the end of the rope and leave the note hanging beside the string.

import { memo, useCallback, useEffect, useRef, useState } from "react";

import type { StringLink } from "../model/types";
import { DRAG_THRESHOLD } from "./useBoardDrag";
import { distanceToYarn, pointOnYarn, type Point } from "./yarn";

export interface StringNoteProps {
  link: StringLink;
  from: Point;
  to: Point;
  selected: boolean;
  toBoard: (clientX: number, clientY: number) => Point;
  onSlide: (id: string, t: number) => void;
  onWrite: (id: string, text: string) => void;
}

export const StringNote = memo(function StringNote({
  link,
  from,
  to,
  selected,
  toBoard,
  onSlide,
  onWrite,
}: StringNoteProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(link.label ?? "");
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const text = link.label ?? "";
  const at = pointOnYarn(from, to, link.labelAt, link.slack);

  // The slide needs the pointer's position, not a delta, so the press is tracked here rather
  // than with `useBoardDrag`.
  const pressRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    travel: number;
  } | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    pressRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      travel: 0,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a refinement; the slide still tracks while over the note.
    }
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      event.stopPropagation();

      press.travel +=
        Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y);
      press.x = event.clientX;
      press.y = event.clientY;
      if (press.travel < DRAG_THRESHOLD) return;

      onSlide(
        link.id,
        tAt(from, to, toBoard(event.clientX, event.clientY), link.slack),
      );
    },
    [from, link.id, link.slack, onSlide, to, toBoard],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      pressRef.current = null;

      if (press.travel < DRAG_THRESHOLD) {
        setDraft(text);
        setEditing(true);
      }
    },
    [text],
  );

  useEffect(() => {
    if (editing) fieldRef.current?.focus();
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    onWrite(link.id, draft.trim());
  }, [draft, link.id, onWrite]);

  if (!text && !selected && !editing) return null;

  return (
    <div
      className="string-note"
      data-testid="string-note"
      style={{ left: at.x, top: at.y }}
      // The board must not also see a press meant for the note.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="string-note-card"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          pressRef.current = null;
        }}
      >
        {editing ? (
          <textarea
            ref={fieldRef}
            value={draft}
            aria-label="Note on this string"
            className="string-note-field"
            placeholder="What does this string mean?"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setDraft(text);
                setEditing(false);
              }
              // The board listens on the document for Delete and Backspace; typing in here is
              // writing, not deleting.
              event.stopPropagation();
            }}
          />
        ) : (
          <span className={text ? "string-note-text" : "string-note-prompt"}>
            {text || "+ note"}
          </span>
        )}
      </div>

      <span aria-hidden="true" className="string-note-dot" />
    </div>
  );
});

export function tAt(
  from: Point,
  to: Point,
  point: Point,
  slack: number,
): number {
  if (Math.hypot(to.x - from.x, to.y - from.y) === 0) return 0.5;

  const { t } = distanceToYarn(from, to, point, slack);
  return Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0.5;
}
