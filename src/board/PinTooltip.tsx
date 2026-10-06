// Rendered through a portal onto `document.body`: a fixed-position card under the transformed
// world would be both clipped and scaled.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import "./PinTooltip.css";

export interface PinTooltipPin {
  id: string;
  quote: string;
  body: string;
  dateLabel: string;
}

export interface PinTooltipProps {
  pin: PinTooltipPin | null;
  anchor: Element | null;
  /** Far below the native tooltip's ~1s, which is what the card exists to avoid. */
  delay?: number;
}

export interface AnchorBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TooltipSize {
  width: number;
  height: number;
}

export type TooltipSide = "above" | "below";

export interface TooltipPosition {
  left: number;
  top: number;
  side: TooltipSide;
  tailX: number;
}

export const PIN_TOOLTIP_DELAY_MS = 120;

export const PIN_TOOLTIP_GAP = 10;

export const PIN_TOOLTIP_MARGIN = 8;

const TAIL_INSET = 14;

export function pinTooltipId(pinId: string): string {
  return `pin-tooltip-${pinId}`;
}

// Below the pin by default, flipping above or to the far side rather than covering it.
// Pure and exported because jsdom has no layout — the component only feeds it measured boxes.
export function placeTooltip(
  anchor: AnchorBox,
  size: TooltipSize,
  viewport: TooltipSize,
  gap: number = PIN_TOOLTIP_GAP,
  margin: number = PIN_TOOLTIP_MARGIN,
): TooltipPosition {
  const centreX = anchor.left + anchor.width / 2;
  const right = anchor.left + anchor.width;
  const bottom = anchor.top + anchor.height;

  const maxLeft = Math.max(margin, viewport.width - margin - size.width);
  let left = centreX - size.width / 2;
  if (
    left + size.width > viewport.width - margin &&
    anchor.left - gap - size.width >= margin
  ) {
    left = anchor.left - gap - size.width;
  } else if (
    left < margin &&
    right + gap + size.width <= viewport.width - margin
  ) {
    left = right + gap;
  }
  left = Math.min(Math.max(left, margin), maxLeft);

  const maxTop = Math.max(margin, viewport.height - margin - size.height);
  let top = bottom + gap;
  let side: TooltipSide = "below";
  if (
    top + size.height > viewport.height - margin &&
    anchor.top - gap - size.height >= margin
  ) {
    top = anchor.top - gap - size.height;
    side = "above";
  }
  top = Math.min(Math.max(top, margin), maxTop);

  const inset = Math.min(TAIL_INSET, size.width / 2);
  const tailX = Math.min(Math.max(centreX - left, inset), size.width - inset);

  return {
    left: Math.round(left),
    top: Math.round(top),
    side,
    tailX: Math.round(tailX),
  };
}

function samePosition(
  previous: TooltipPosition | null,
  next: TooltipPosition,
): boolean {
  return (
    previous !== null &&
    previous.left === next.left &&
    previous.top === next.top &&
    previous.side === next.side &&
    previous.tailX === next.tailX
  );
}

export function PinTooltip({
  pin,
  anchor,
  delay = PIN_TOOLTIP_DELAY_MS,
}: PinTooltipProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  // Bumped to restart the reveal delay, or cancel a timer already in flight.
  const [hoverEpoch, setHoverEpoch] = useState(0);

  const pinId = pin?.id ?? null;
  const pinIdRef = useRef(pinId);
  pinIdRef.current = pinId;

  const silencedRef = useRef<string | null>(null);

  const silence = useCallback(() => {
    if (pinIdRef.current === null) return;
    silencedRef.current = pinIdRef.current;
    setShown(false);
    // Re-running the delay effect clears any pending timer, so a leave mid-delay cannot be
    // overridden by the reveal landing after it.
    setHoverEpoch((epoch) => epoch + 1);
  }, []);

  useEffect(() => {
    if (pinId === null) {
      silencedRef.current = null;
      setShown(false);
      return;
    }
    if (silencedRef.current === pinId) return;

    setShown(false);
    const timer = window.setTimeout(() => setShown(true), delay);
    return () => window.clearTimeout(timer);
  }, [pinId, delay, hoverEpoch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") silence();
    };
    // Scroll does not bubble, so capture is the only way to hear it from a pane above the
    // board; a card left behind by a scroll would point at where the pin used to be.
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", silence, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", silence, true);
    };
  }, [silence]);

  // Listening on the pin itself also re-arms a card silenced by Escape: leave silences it,
  // re-entering starts the delay again.
  useEffect(() => {
    if (!anchor) return;
    const onEnter = (): void => {
      if (silencedRef.current === pinIdRef.current) silencedRef.current = null;
      setHoverEpoch((epoch) => epoch + 1);
    };
    anchor.addEventListener("pointerenter", onEnter);
    anchor.addEventListener("pointerleave", silence);
    return () => {
      anchor.removeEventListener("pointerenter", onEnter);
      anchor.removeEventListener("pointerleave", silence);
    };
  }, [anchor, silence]);

  // Measured before paint, so the card is never painted at the wrong spot.
  useLayoutEffect(() => {
    if (!shown) {
      setPosition((previous) => (previous === null ? previous : null));
      return;
    }

    const box = cardRef.current?.getBoundingClientRect();
    // jsdom has no layout: every box is zero, which would park the card at the corner, so
    // leave it unplaced and let the placement maths be tested directly.
    if (!box || box.width === 0 || box.height === 0) return;

    const rect = anchor?.getBoundingClientRect();
    if (!rect) return;

    const next = placeTooltip(
      rect,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPosition((previous) => (samePosition(previous, next) ? previous : next));
  }, [shown, pin, anchor]);

  if (pin === null || anchor === null || !shown) return null;

  return createPortal(
    <div
      ref={cardRef}
      id={pinTooltipId(pin.id)}
      role="tooltip"
      data-side={position?.side ?? "below"}
      className={
        position === null ? "pin-tooltip" : "pin-tooltip pin-tooltip--placed"
      }
      style={
        {
          left: position?.left ?? 0,
          top: position?.top ?? 0,
          "--tail-x": `${position?.tailX ?? 0}px`,
        } as CSSProperties
      }
    >
      <span className="pin-tooltip__tail" />
      {pin.quote ? <p className="pin-tooltip__quote">“{pin.quote}”</p> : null}
      {pin.body ? <p className="pin-tooltip__body">{pin.body}</p> : null}
      {pin.dateLabel ? (
        <p className="pin-tooltip__date">{pin.dateLabel}</p>
      ) : null}
    </div>,
    document.body,
  );
}
