/**
 * The fast hover card for a board pin.
 *
 * A pin currently carries a native `title`, which the browser holds back for
 * roughly a second and paints like a browser tooltip. On a board you scan with
 * the pointer that second is the difference between reading the board and
 * waiting on it, so this card shows after {@link PIN_TOOLTIP_DELAY_MS} and can
 * carry formatted content.
 *
 * It renders through a portal onto `document.body`. The board's world is one
 * scaled CSS transform inside `overflow: hidden`, and a fixed-position card
 * under a transformed ancestor would be both clipped and scaled; on the body
 * it is plain viewport coordinates, which is what the placement maths assumes.
 *
 * Contract: `pin | null` plus the anchor element. `null` is the simplest way
 * to say "nothing is hovered", and the caller already holds the hovered pin in
 * state — a hook would add a second source of truth for what is under the
 * cursor. The anchor is the pin element rather than a rect because the
 * component then watches `pointerleave` itself and re-measures the pin, whose
 * viewport rect the board's zoom makes stale. It renders nothing when either
 * prop is null, so a caller can mount it once and leave it up.
 *
 * Accessibility: the card is `role="tooltip"` with the deterministic id
 * `pinTooltipId(pin.id)`. Wire it up by putting
 * `aria-describedby={pinTooltipId(pin.id)}` on the tack. Deterministic rather
 * than generated: the pin can then name the card across the portal without a
 * ref, and while no card is mounted the id resolves to nothing, which
 * `aria-describedby` ignores.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'

import './PinTooltip.css'

/** The pin data the card shows — a structural slice of the app's PinView. */
export interface PinTooltipPin {
  id: string
  /** The words the pin is anchored to. Empty for a pin stuck into the cork. */
  quote: string
  /** The written note. Empty when nobody has written on the pin yet. */
  body: string
  dateLabel: string
}

export interface PinTooltipProps {
  /** The hovered pin, or null when the pointer is not on one. */
  pin: PinTooltipPin | null
  /**
   * The pin element itself — the tack under the pointer. An element rather
   * than a rect, so the card can watch `pointerleave` and re-measure the
   * pin, whose viewport rect the board's zoom changes.
   */
  anchor: Element | null
  /**
   * How long the pointer must rest on the pin before the card appears, in ms.
   * Deliberately far below the native tooltip's ~1s: the card exists to make
   * scanning a board fast.
   */
  delay?: number
}

/** A viewport-space box — the slice of DOMRect that placement needs. */
export interface AnchorBox {
  left: number
  top: number
  width: number
  height: number
}

export interface TooltipSize {
  width: number
  height: number
}

export type TooltipSide = 'above' | 'below'

export interface TooltipPosition {
  left: number
  top: number
  /** Which side of the pin the card landed on; picks which edge the notch hugs. */
  side: TooltipSide
  /** Horizontal offset of the notch inside the card, px. */
  tailX: number
}

/** Under the native tooltip's ~1s, and under the 200ms goal with room to spare. */
export const PIN_TOOLTIP_DELAY_MS = 120

/** Clearance between the pin's box and the card, leaving room for the notch. */
export const PIN_TOOLTIP_GAP = 10

/** Closest the card may come to a viewport edge. */
export const PIN_TOOLTIP_MARGIN = 8

/** How far the notch stays from the card's corners. */
const TAIL_INSET = 14

/** The id the card carries, so a tack can point `aria-describedby` at it. */
export function pinTooltipId(pinId: string): string {
  return `pin-tooltip-${pinId}`
}

/**
 * Where the card's top-left corner goes, in viewport coordinates.
 *
 * Below the pin by default — reading order — flipping above when the card
 * would hang off the bottom and there is room up there. Horizontally it
 * centres on the pin and flips to the far side when the centred card would
 * cross an edge, so the card never covers the pin it describes. The card is
 * the thing that moves; clamping is the last resort, for a card with no room
 * on either side. An oversized card then loses its far edge rather than its
 * first line.
 *
 * Pure and exported because the DOM under test has no layout: this is the
 * part worth testing, and the component only feeds it measured boxes.
 */
export function placeTooltip(
  anchor: AnchorBox,
  size: TooltipSize,
  viewport: TooltipSize,
  gap: number = PIN_TOOLTIP_GAP,
  margin: number = PIN_TOOLTIP_MARGIN,
): TooltipPosition {
  const centreX = anchor.left + anchor.width / 2
  const right = anchor.left + anchor.width
  const bottom = anchor.top + anchor.height

  const maxLeft = Math.max(margin, viewport.width - margin - size.width)
  let left = centreX - size.width / 2
  if (left + size.width > viewport.width - margin && anchor.left - gap - size.width >= margin) {
    left = anchor.left - gap - size.width
  } else if (left < margin && right + gap + size.width <= viewport.width - margin) {
    left = right + gap
  }
  left = Math.min(Math.max(left, margin), maxLeft)

  const maxTop = Math.max(margin, viewport.height - margin - size.height)
  let top = bottom + gap
  let side: TooltipSide = 'below'
  if (top + size.height > viewport.height - margin && anchor.top - gap - size.height >= margin) {
    top = anchor.top - gap - size.height
    side = 'above'
  }
  top = Math.min(Math.max(top, margin), maxTop)

  // The notch follows the pin's centre but stays clear of the rounded corners.
  const inset = Math.min(TAIL_INSET, size.width / 2)
  const tailX = Math.min(Math.max(centreX - left, inset), size.width - inset)

  return { left: Math.round(left), top: Math.round(top), side, tailX: Math.round(tailX) }
}

function samePosition(previous: TooltipPosition | null, next: TooltipPosition): boolean {
  return (
    previous !== null &&
    previous.left === next.left &&
    previous.top === next.top &&
    previous.side === next.side &&
    previous.tailX === next.tailX
  )
}

export function PinTooltip({ pin, anchor, delay = PIN_TOOLTIP_DELAY_MS }: PinTooltipProps) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(false)
  const [position, setPosition] = useState<TooltipPosition | null>(null)
  // Bumped to restart the reveal delay: a fresh hover, or a dismissal that
  // must cancel a timer already in flight.
  const [hoverEpoch, setHoverEpoch] = useState(0)

  const pinId = pin?.id ?? null
  // The document-level listeners outlive a render, so they read the live pin
  // through a ref instead of being torn down and re-registered per hover.
  const pinIdRef = useRef(pinId)
  pinIdRef.current = pinId

  /** The pin id that Escape, a scroll or the pointer leaving has silenced. */
  const silencedRef = useRef<string | null>(null)

  const silence = useCallback(() => {
    if (pinIdRef.current === null) return
    silencedRef.current = pinIdRef.current
    setShown(false)
    // Re-running the delay effect is what clears a timer already pending, so
    // a leave mid-delay cannot be overridden by the reveal landing after it.
    setHoverEpoch((epoch) => epoch + 1)
  }, [])

  useEffect(() => {
    if (pinId === null) {
      // Off the pins entirely: the next hover is a fresh chance to show.
      silencedRef.current = null
      setShown(false)
      return
    }
    if (silencedRef.current === pinId) return

    setShown(false)
    const timer = window.setTimeout(() => setShown(true), delay)
    return () => window.clearTimeout(timer)
  }, [pinId, delay, hoverEpoch])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') silence()
    }
    // Scroll does not bubble, so capture is the only way to hear it from a
    // pane above the board. A card left behind by a scroll would point at
    // where the pin used to be.
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', silence, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', silence, true)
    }
  }, [silence])

  // The pin's own enter and leave are the most direct signals. Listening here
  // rather than relying on the caller to null the pin also re-arms a card
  // silenced by Escape: leave silences it, re-entering starts the delay again.
  useEffect(() => {
    if (!anchor) return
    const onEnter = (): void => {
      if (silencedRef.current === pinIdRef.current) silencedRef.current = null
      setHoverEpoch((epoch) => epoch + 1)
    }
    anchor.addEventListener('pointerenter', onEnter)
    anchor.addEventListener('pointerleave', silence)
    return () => {
      anchor.removeEventListener('pointerenter', onEnter)
      anchor.removeEventListener('pointerleave', silence)
    }
  }, [anchor, silence])

  // Measured after mount and after any content change, before paint: the card
  // renders unplaced (transparent), so it is never painted at the wrong spot.
  useLayoutEffect(() => {
    if (!shown) {
      setPosition((previous) => (previous === null ? previous : null))
      return
    }

    const card = cardRef.current
    const box = card?.getBoundingClientRect()
    // jsdom has no layout at all — every box is zero, which would park the
    // card at the corner. Staying unplaced keeps the tests honest about
    // placement: the maths is tested directly, not through a fake DOM.
    if (!card || !box || box.width === 0 || box.height === 0) return

    const rect = anchor?.getBoundingClientRect()
    if (!rect) return

    const next = placeTooltip(rect, { width: box.width, height: box.height }, {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    setPosition((previous) => (samePosition(previous, next) ? previous : next))
  }, [shown, pin, anchor])

  if (pin === null || anchor === null || !shown) return null

  return createPortal(
    <div
      ref={cardRef}
      id={pinTooltipId(pin.id)}
      role="tooltip"
      data-side={position?.side ?? 'below'}
      className={position === null ? 'pin-tooltip' : 'pin-tooltip pin-tooltip--placed'}
      style={
        {
          left: position?.left ?? 0,
          top: position?.top ?? 0,
          '--tail-x': `${position?.tailX ?? 0}px`,
        } as CSSProperties
      }
    >
      <span className="pin-tooltip__tail" />
      {pin.quote ? <p className="pin-tooltip__quote">“{pin.quote}”</p> : null}
      {pin.body ? <p className="pin-tooltip__body">{pin.body}</p> : null}
      {pin.dateLabel ? <p className="pin-tooltip__date">{pin.dateLabel}</p> : null}
    </div>,
    document.body,
  )
}
