import type { PointerEvent } from 'react'

import { useBoardDrag } from '../useBoardDrag'
import type { PinView } from '../view'
import type { Point } from '../yarn'
import { pinTooltipId } from '../PinTooltip'

/**
 * A brass tack — the same object whether it is holding a word or a patch of
 * cork, so the drag means the same thing on both and you never have to work out
 * which kind you are looking at.
 *
 * Normally dragging one runs a string. While it is the pin being repositioned,
 * the drag moves it instead: a mode rather than a second button, because
 * "connect" and "move" on the same target would otherwise be indistinguishable.
 *
 * `data-described` drives a ring around tacks that have something written on
 * them, so an annotated pin is findable at a glance across a crowded board.
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
  /** Only fires in move mode: where the pin was let go of. */
  onDrop: (id: string, clientX: number, clientY: number) => void
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

  return (
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
  )
}

