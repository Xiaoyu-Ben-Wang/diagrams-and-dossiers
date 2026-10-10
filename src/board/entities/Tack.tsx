import { memo, useRef, type PointerEvent } from "react";

import { useBoardDrag } from "../useBoardDrag";
import type { PinView } from "../view";
import type { Point } from "../yarn";
import { pinTooltipId } from "../PinTooltip";
import { TACK_SIZE } from "../../model/kinds";

const TACK_HALF = TACK_SIZE / 2;

export const Tack = memo(function Tack({
  pin,
  z = 0,
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
  pin: PinView;
  /** The board stack rank from `stackingRanks`; a pin anchored to a page has none. */
  z?: number;
  x: number;
  y: number;
  selected: boolean;
  dimmed?: boolean;
  moving: boolean;
  zoom: number;
  onStartYarn: (event: PointerEvent, pin: PinView) => void;
  onMove: (id: string, delta: Point) => void;
  onDrop: (id: string, clientX: number, clientY: number) => void;
  onOpenEditor: (id: string, clientX: number, clientY: number) => void;
  onHover: (pin: PinView, element: Element | null) => void;
}) {
  const drag = useBoardDrag({
    zoom,
    onDrag: (delta) => onMove(pin.id, delta),
    // The drag handlers are bound only in move mode, so this can only fire while repositioning.
    onEnd: (end) => onDrop(pin.id, end.clientX, end.clientY),
  });

  const described = pin.body.trim().length > 0;

  // The drop is reported as the pin's new position, so subtract where on the tag the press
  // landed; otherwise the tack snaps to the finger, thirty-odd px below the pin.
  const tagGrabRef = useRef<{ dx: number; dy: number } | null>(null);

  const tagDrag = useBoardDrag({
    zoom,
    onDrag: (delta) => onMove(pin.id, delta),
    onEnd: (end) => {
      if (!end.travelled) {
        onOpenEditor(pin.id, end.clientX, end.clientY);
        return;
      }
      const grab = tagGrabRef.current ?? { dx: 0, dy: 0 };
      onDrop(pin.id, end.clientX - grab.dx, end.clientY - grab.dy);
    },
  });

  // The tag is placed from the pin's coordinates, so the tack's centre is `TACK_HALF * zoom`
  // above the tag's top edge; recover it from the tag's box.
  const grabFromTag = (event: PointerEvent<HTMLSpanElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    tagGrabRef.current = {
      dx: event.clientX - (box.left + box.width / 2),
      dy: event.clientY - (box.top - TACK_HALF * zoom),
    };
  };

  return (
    <>
      {described ? (
        <span
          aria-hidden="true"
          className="pin-tag"
          // Carries the pin's identity so things that resolve an entity from what is under the
          // pointer — middle drag, context menu — find the pin, not the cork beneath.
          data-pin-id={pin.id}
          data-board-entity="pin"
          {...tagDrag}
          // After the spread, so this runs as well as the drag's own press handling.
          onPointerDown={(event) => {
            grabFromTag(event);
            tagDrag.onPointerDown(event);
          }}
          style={{ left: x + TACK_HALF, top: y + TACK_SIZE }}
        >
          <span className="pin-tag__cord" />
          <span className="pin-tag__card">
            <span className="pin-tag__hole" />
            {pin.quote ? (
              <span className="pin-tag__quote">“{pin.quote}”</span>
            ) : null}
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
        data-described={described ? "true" : undefined}
        {...(moving
          ? drag
          : {
              onPointerDown: (event: PointerEvent) => onStartYarn(event, pin),
            })}
        onPointerEnter={(event) => onHover(pin, event.currentTarget)}
        onPointerLeave={() => onHover(pin, null)}
        // Safe unconditionally: the id only exists while the card is mounted, and aria-describedby
        // ignores an absent id.
        aria-describedby={pinTooltipId(pin.id)}
        // `pointer-events-auto` is load-bearing: an anchored pin's overlay is `pointer-events-none`
        // so the article's text keeps its hit-testing, and a tack inheriting that could not be pressed.
        className={`tack tack-enter pointer-events-auto absolute h-3.5 w-3.5 rounded-full ${
          moving ? "cursor-grabbing" : "cursor-crosshair"
        } ${selected ? "is-selected" : ""}`}
        data-status={pin.status}
        style={{
          left: x,
          top: y,
          zIndex: z,
          touchAction: "none",
          opacity: dimmed ? 0.2 : 1,
        }}
        aria-label={
          described
            ? `Pin: ${pin.body}`
            : pin.quote
              ? `Pin on "${pin.quote}", ${pin.detail}`
              : "Pin on the board, no description yet"
        }
      />
    </>
  );
});
