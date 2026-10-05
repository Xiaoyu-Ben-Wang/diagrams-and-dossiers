/**
 * The note hanging on a string.
 *
 * A board of red wool says which things are connected and nothing about why.
 * This is the label that answers that: a small card strung on the line, sitting
 * where it was slid to and following both ends wherever they are dragged —
 * because its position is stored as a *place along the rope* rather than a
 * point on the board, so it cannot be left behind by one.
 *
 * Shaped like the post-its, deliberately: same paper, same small pin. It is the
 * same kind of thing, attached to a line instead of to the cork. The pin is
 * drawn at the point it hangs from, which is the bottom tip of the card, where
 * a tag's hole would be.
 *
 * Two gestures, told apart by travel the way every other drag on this board is:
 * a press that moves slides the note along the string, a press that does not
 * opens it for writing.
 *
 * The slide projects the pointer onto the curve rather than applying a delta.
 * That is what keeps the note *on* the rope — a delta can be accumulated off
 * the end of it, or across to the other side of the sag, and the note would
 * then be hanging beside the string rather than on it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { StringLink } from '../model/types'
import { DRAG_THRESHOLD } from './useBoardDrag'
import { distanceToYarn, pointOnYarn, type Point } from './yarn'

export interface StringNoteProps {
  link: StringLink
  /** Both ends of the string, in board space. */
  from: Point
  to: Point
  /** Whether the string under it is selected, which invites adding a note. */
  selected: boolean
  /**
   * A viewport point in board space.
   *
   * Needed because the slide projects the pointer onto the curve, and the
   * pointer arrives in viewport coordinates.
   */
  toBoard: (clientX: number, clientY: number) => Point
  /** Slide it to a new place along the rope, 0..1. */
  onSlide: (t: number) => void
  /** Write on it. An empty string removes it. */
  onWrite: (text: string) => void
}

export function StringNote({
  link,
  from,
  to,
  selected,
  toBoard,
  onSlide,
  onWrite,
}: StringNoteProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(link.label ?? '')
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  const text = link.label ?? ''
  const at = pointOnYarn(from, to, link.labelAt, link.slack)

  /**
   * The press in progress, and how far it has travelled.
   *
   * Kept here rather than taken from `useBoardDrag` because the slide needs the
   * pointer's *position*, not a delta — the hook reports movement, and there is
   * no way to recover an absolute point from accumulated deltas without
   * drifting a little on every frame.
   */
  const pressRef = useRef<{ pointerId: number; x: number; y: number; travel: number } | null>(null)

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return
    event.stopPropagation()
    pressRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      travel: 0,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Capture is a refinement; the slide still tracks while over the note.
    }
  }, [])

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const press = pressRef.current
      if (!press || press.pointerId !== event.pointerId) return
      event.stopPropagation()

      press.travel += Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y)
      press.x = event.clientX
      press.y = event.clientY
      if (press.travel < DRAG_THRESHOLD) return

      onSlide(tAt(from, to, toBoard(event.clientX, event.clientY), link.slack))
    },
    [from, link.slack, onSlide, to, toBoard],
  )

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    const press = pressRef.current
    if (!press || press.pointerId !== event.pointerId) return
    pressRef.current = null

    // A press that never travelled is a click, and a click opens the note.
    if (press.travel < DRAG_THRESHOLD) {
      setDraft(text)
      setEditing(true)
    }
  }, [text])

  useEffect(() => {
    if (editing) fieldRef.current?.focus()
  }, [editing])

  const commit = useCallback(() => {
    setEditing(false)
    onWrite(draft.trim())
  }, [draft, onWrite])

  // A string with no note only grows one while it is selected, so an unselected
  // board is not covered in invitations.
  if (!text && !selected && !editing) return null

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
          pressRef.current = null
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
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                commit()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setDraft(text)
                setEditing(false)
              }
              // The board listens on the document for Delete and Backspace;
              // typing in here is writing, not deleting.
              event.stopPropagation()
            }}
          />
        ) : (
          <span className={text ? 'string-note-text' : 'string-note-prompt'}>
            {text || '+ note'}
          </span>
        )}
      </div>

      {/* The pin it hangs from, at the bottom tip — where a tag's hole is. */}
      <span aria-hidden="true" className="string-note-pin" />
    </div>
  )
}

/**
 * Where along a string a board point falls, as a fraction.
 *
 * Sampling the curve rather than solving it. The nearest point on a quadratic
 * has a closed form, but deriving it is a cubic and this is feeding a drag
 * where a pixel of disagreement is invisible — and the board already samples
 * this exact curve at this exact resolution to hit-test a click on the wool, so
 * the two agree by construction rather than by both being right.
 */
export function tAt(from: Point, to: Point, point: Point, slack: number): number {
  // No rope, so no "along" it: every place on it is the same place, and the
  // sampler's tie-breaking would otherwise decide this by accident.
  if (Math.hypot(to.x - from.x, to.y - from.y) === 0) return 0.5

  const { t } = distanceToYarn(from, to, point, slack)
  return Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0.5
}
