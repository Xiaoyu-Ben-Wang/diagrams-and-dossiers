// `pointer-events-none` throughout, or the yarn on top would swallow clicks meant for the pins
// underneath; the grabbable sag handle is rendered separately by the board.

import { memo, useId, useMemo, type CSSProperties, type Ref } from "react";

import { TACK_RADIUS } from "../model/kinds";
import { STRING_HALO_PX } from "./tuning";
import type { DrawableString } from "./view";
import { seedFromKey, yarnStrands, type YarnStyle } from "./yarn-style";
import { YARN_BASE, yarnColorCss } from "./yarn-color";
import { yarnPath, type Point } from "./yarn";
import { YarnStrokes } from "./YarnStrokes";

export interface StringLayerProps {
  strings: readonly DrawableString[];
  selected: ReadonlySet<string>;
  hovered: string | null;
  style: YarnStyle;
  shadow: boolean;
  zoom: number;
  // A ref rather than a prop: the drag runs on rAF and writes `d` directly, keeping a live
  // string off React's render path.
  livePathRef: Ref<SVGPathElement>;
  drawing: boolean;
  /** Tack centres. The tacks sit in rotated sheets and cards, stacking contexts no
   * z-index can lift over this layer, so the yarn is cut away beneath them instead. */
  tacks: readonly Point[];
}

// Far past any board; the mask hides whatever falls outside it.
const MASK_EXTENT = 1e6;

export const StringLayer = memo(function StringLayer({
  strings,
  selected,
  hovered,
  style,
  shadow,
  zoom,
  livePathRef,
  drawing,
  tacks,
}: StringLayerProps) {
  const maskId = `tack-holes-${useId()}`;
  return (
    <svg
      data-testid="string-layer"
      className="pointer-events-none absolute top-0 left-0 z-20 overflow-visible"
      width={1}
      height={1}
      aria-hidden="true"
    >
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x={-MASK_EXTENT}
        y={-MASK_EXTENT}
        width={MASK_EXTENT * 2}
        height={MASK_EXTENT * 2}
      >
        <rect
          x={-MASK_EXTENT}
          y={-MASK_EXTENT}
          width={MASK_EXTENT * 2}
          height={MASK_EXTENT * 2}
          fill="white"
        />
        {tacks.map((tack, index) => (
          <circle
            key={index}
            cx={tack.x}
            cy={tack.y}
            r={TACK_RADIUS}
            fill="black"
          />
        ))}
      </mask>
      <g mask={`url(#${maskId})`}>
        {strings.map((string) => {
          const halo = selected.has(string.id)
            ? "selected"
            : hovered === string.id
              ? "hovered"
              : null;
          return (
            <StringRow
              key={string.id}
              id={string.id}
              from={string.from}
              to={string.to}
              slack={string.slack}
              color={string.color}
              halo={halo}
              // Zero without a halo, so a zoom leaves unhighlighted rows alone.
              haloWidth={halo ? STRING_HALO_PX / (zoom || 1) : 0}
              style={style}
              shadow={shadow}
            />
          );
        })}

        <path
          ref={livePathRef}
          data-testid="live-yarn"
          className="yarn-paint"
          fill="none"
          stroke={YARN_BASE}
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={drawing ? 0.95 : 0}
        />
      </g>
    </svg>
  );
});

interface StringRowProps {
  id: string;
  from: Point;
  to: Point;
  slack: number;
  color: string;
  halo: "selected" | "hovered" | null;
  haloWidth: number;
  style: YarnStyle;
  shadow: boolean;
}

const StringRow = memo(function StringRow({
  id,
  from,
  to,
  slack,
  color,
  halo,
  haloWidth,
  style,
  shadow,
}: StringRowProps) {
  const strands = useMemo(
    () => yarnStrands(style, from, to, slack, seedFromKey(id), { shadow }),
    [style, from, to, slack, id, shadow],
  );

  return (
    <g
      data-testid="yarn"
      className="yarn-paint"
      style={{ "--yarn-base": yarnColorCss(color) } as CSSProperties}
    >
      {halo ? (
        <path
          data-testid="yarn-halo"
          d={yarnPath(from, to, slack)}
          fill="none"
          stroke={YARN_BASE}
          strokeOpacity={halo === "selected" ? 0.22 : 0.12}
          strokeWidth={haloWidth}
          strokeLinecap="round"
        />
      ) : null}
      <YarnStrokes strands={strands} />
    </g>
  );
});
