import { useRef, type PointerEvent } from 'react'

import { useBoardDrag } from '../useBoardDrag'
import type { PinView } from '../view'
import type { Point } from '../yarn'
import { pinTooltipId } from '../PinTooltip'
import { TACK_SIZE } from '../../model/kinds'

/**
 * Half a tack, for hanging something off its centre.
 *
 * From `TACK_SIZE` rather than the class below, because the tag's position and
 * the tack's own footprint have to agree: a tag hung off a number that drifted
 * from the tack's width would hang beside it rather than from it.
 */
const TACK_HALF = TACK_SIZE / 2

/**
 * A brass tack — the same object whether it is holding a word or a patch of
 * cork, so the drag means the same thing on both and you never have to work out
 * which kind you are looking at.
 *
 * Normally dragging one runs a string. While it is the pin being repositioned,
 * the drag moves it instead: a mode rather than a second button, because
 * "connect" and "move" on the same target would otherwise be indistinguishable.
 *
 * A tack with something written on it wears a tag — a label on a short cord,
 * the way a tag hangs off a pin on a real board. It used to wear a ring of
 * brass instead, which said only *that* there was something to read and left
 * you to hover to find out what; the tag says it, and says it on the board.
 */
export function Tack({
  pin,
  x,
  y,
  selected,
  dimmed = false,
  moving,
  zoom,
  onStartYarn,
  onMove,
  onDrop,
  onOpenEditor,
  onHover,
}: {
  pin: PinView
  x: number
  y: number
  selected: boolean
  /** Faded because the timeline is holding it back. Nothing does now. */
  dimmed?: boolean
  moving: boolean
  zoom: number
  onStartYarn: (event: PointerEvent) => void
  onMove: (id: string, delta: Point) => void
  /** Only fires in move mode, or from the tag: where the pin was let go of. */
  onDrop: (id: string, clientX: number, clientY: number) => void
  /** Open the pin's editor at a point on screen. */
  onOpenEditor: (id: string, clientX: number, clientY: number) => void
  onHover: (pin: PinView, element: Element | null) => void
}) {
  const drag = useBoardDrag({
    zoom,
    onDrag: (delta) => onMove(pin.id, delta),
    // The drag handlers are bound only in move mode — outside it a press on a
    // tack starts a string instead — so this can only fire while repositioning.
    onEnd: (end) => onDrop(pin.id, end.clientX, end.clientY),
  })

  const described = pin.body.trim().length > 0

  /**
   * The tag is a handle, so the pin can be moved by the thing that says what it
   * is.
   *
   * The tack itself is fourteen pixels across and carries a different gesture
   * depending on the mode; its tag is four or five times the target and carries
   * only this one. So the meaning is the same in every mode: drag to move the
   * pin, and let go over a page to re-pin it to the words under the pointer —
   * exactly what dragging the tack does in move mode, without having to be in
   * it.
   *
   * This reverses what the tag used to be. It was `pointer-events: none`, on the
   * grounds that a label four times the size of its pin would swallow presses on
   * the cork around every annotated pin — which is true, and is now paid for
   * deliberately. What makes it worth paying is that the press is not lost: it
   * lands on the pin the tag belongs to. The click is answered too, rather than
   * left dead, because a target that does nothing is how the tag would be
   * *worse* than the hole it punches: a press here used to fall through to the
   * board and is now intercepted.
   */
  /**
   * Where on the tag the press landed, relative to the tack's centre.
   *
   * The drop is reported to the board as a *position*, and the board uses it as
   * where the pin now is — so handing it the pointer's coordinates would snap
   * the pin's tack to wherever on the tag the finger happened to be, which is
   * thirty-odd pixels below the pin. Grabbing the tack itself has never shown
   * this because the two are the same point.
   */
  const tagGrabRef = useRef<{ dx: number; dy: number } | null>(null)

  const tagDrag = useBoardDrag({
    zoom,
    onDrag: (delta) => onMove(pin.id, delta),
    onEnd: (end) => {
      if (!end.travelled) {
        // A press that stayed put opens the pin's editor, which is what a click
        // on the tack itself already means and what the writing on the tag is
        // inviting.
        onOpenEditor(pin.id, end.clientX, end.clientY)
        return
      }
      const grab = tagGrabRef.current ?? { dx: 0, dy: 0 }
      onDrop(pin.id, end.clientX - grab.dx, end.clientY - grab.dy)
    },
  })

  /**
   * The tack's centre, in screen pixels, from the tag's own box.
   *
   * The tag is placed from the pin's coordinates: its anchor is the pin's x —
   * the `translateX(-50%)` in the stylesheet centres it there — and its top edge
   * is `TACK_SIZE` below the pin's y, which puts the tack's centre `TACK_HALF`
   * above it. So the two are a fixed distance apart on the board, and the
   * distance on screen is that times the zoom.
   */
  const grabFromTag = (event: PointerEvent<HTMLSpanElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    tagGrabRef.current = {
      dx: event.clientX - (box.left + box.width / 2),
      dy: event.clientY - (box.top - TACK_HALF * zoom),
    }
  }

  return (
    <>
      {/* A tag on every pin that has something written on it.
          This is what `data-described` used to signal with a ring of brass
          around the tack — a mark that said "there is something here" and then
          made you hover to find out what. A tag says it outright, which is
          what a tag is for, and it is what the thing would be on a real board:
          a label on a string, not a glow.
          `aria-hidden` because the tack's own label already carries the words;
          reading them twice is worse than not reading them here. */}
      {described ? (
        <span
          aria-hidden="true"
          className="pin-tag"
          // Carries the pin's identity as well as its contents, so everything
          // that resolves an entity from what is under the pointer — the middle
          // drag, the context menu — finds the pin rather than the cork beneath
          // it. Without these the tag would be a hole in the board that answers
          // for nothing.
          data-pin-id={pin.id}
          data-board-entity="pin"
          {...tagDrag}
          // After the spread, so it runs as well as the drag's own press
          // handling rather than instead of it.
          onPointerDown={(event) => {
            grabFromTag(event)
            tagDrag.onPointerDown(event)
          }}
          style={{ left: x + TACK_HALF, top: y + TACK_SIZE }}
        >
          <span className="pin-tag__cord" />
          <span className="pin-tag__card">
            <span className="pin-tag__hole" />
            {pin.quote ? <span className="pin-tag__quote">“{pin.quote}”</span> : null}
            <span className="pin-tag__body">{pin.body}</span>
            {pin.dateLabel ? (
              <span className="pin-tag__date">
                <span className="pin-tag__dot" />
                {pin.dateLabel}
              </span>
            ) : null}
          </span>
        </span>
      ) : null}

      <button
      type="button"
      data-pin-id={pin.id}
      data-board-entity="pin"
      data-described={described ? 'true' : undefined}
      {...(moving ? drag : { onPointerDown: onStartYarn })}
      onPointerEnter={(event) => onHover(pin, event.currentTarget)}
      onPointerLeave={() => onHover(pin, null)}
      // The id only exists while the card is mounted, which aria-describedby
      // ignores — so this is safe to declare unconditionally.
      aria-describedby={pinTooltipId(pin.id)}
      // pointer-events-auto is load-bearing on anchored pins: their overlay is
      // pointer-events-none so the article's text keeps its own hit-testing, and
      // a tack that inherits that cannot be pressed at all — so no yarn could
      // ever start from a pin stuck in a word. Re-enabling it here, on the tack
      // alone, leaves the rest of the overlay transparent to the text.
      className={`tack tack-enter pointer-events-auto absolute h-3.5 w-3.5 rounded-full ${
        moving ? 'cursor-grabbing' : 'cursor-crosshair'
      } ${selected ? 'is-selected' : ''}`}
      data-status={pin.status}
      style={{
        left: x,
        top: y,
        touchAction: 'none',
        opacity: dimmed ? 0.2 : 1,
      }}
        aria-label={
          described
            ? `Pin: ${pin.body}`
            : pin.quote
              ? `Pin on "${pin.quote}", ${pin.detail}`
              : 'Pin on the board, no description yet'
        }
      />
    </>
  )
}

