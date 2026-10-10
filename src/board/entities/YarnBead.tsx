import { memo } from "react";

import { HANDLE_SIZE } from "../tuning";
import { useBoardDrag } from "../useBoardDrag";
import { pointOnYarn, type Point } from "../yarn";
import { yarnColorCss } from "../yarn-color";

// Only the vertical component of the drag is used: feeding sideways travel into the sag would
// make the string lurch whenever the hand drifted.
export const YarnBead = memo(function YarnBead({
  id,
  from,
  to,
  slack,
  color,
  zoom,
  onSag,
}: {
  id: string;
  from: Point;
  to: Point;
  slack: number;
  color: string;
  zoom: number;
  onSag: (id: string, dy: number) => void;
}) {
  const drag = useBoardDrag({ zoom, onDrag: (delta) => onSag(id, delta.y) });
  const apex = pointOnYarn(from, to, 0.5, slack);

  return (
    <button
      type="button"
      data-testid="yarn-bead"
      aria-label="Drag up or down to adjust how much the string sags"
      className="yarn-bead tack-enter absolute"
      style={{
        left: apex.x - HANDLE_SIZE / 2,
        top: apex.y - HANDLE_SIZE / 2,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
        touchAction: "none",
      }}
      {...drag}
    >
      <svg viewBox="0 0 20 20" className="yarn-bead-glyph" aria-hidden="true">
        <path
          d="M 10 4.5 V 15.5 M 6.4 8.1 L 10 4.5 L 13.6 8.1 M 6.4 11.9 L 10 15.5 L 13.6 11.9"
          fill="none"
          stroke={yarnColorCss(color)}
          strokeWidth={2.1}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
});
