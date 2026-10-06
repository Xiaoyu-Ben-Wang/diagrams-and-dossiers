// `pointer-events-none` throughout, or the yarn on top would swallow clicks meant for the pins
// underneath; the grabbable sag handle is rendered separately by the board.

import { memo, useMemo, type Ref } from "react";

import { STRING_HALO_PX } from "./tuning";
import type { DrawableString } from "./view";
import { seedFromKey, yarnStrands, type YarnStyle } from "./yarn-style";
import { YARN_COLOR, yarnPath, type Point } from "./yarn";
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
}

export const StringLayer = memo(function StringLayer({
  strings,
  selected,
  hovered,
  style,
  shadow,
  zoom,
  livePathRef,
  drawing,
}: StringLayerProps) {
  return (
    <svg
      data-testid="string-layer"
      className="pointer-events-none absolute top-0 left-0 z-20 overflow-visible"
      width={1}
      height={1}
      aria-hidden="true"
    >
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
        fill="none"
        stroke={YARN_COLOR}
        strokeWidth={2.5}
        strokeLinecap="round"
        opacity={drawing ? 0.95 : 0}
      />
    </svg>
  );
});

interface StringRowProps {
  id: string;
  from: Point;
  to: Point;
  slack: number;
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
    <g>
      {halo ? (
        <path
          data-testid="yarn-halo"
          d={yarnPath(from, to, slack)}
          fill="none"
          stroke={YARN_COLOR}
          strokeOpacity={halo === "selected" ? 0.22 : 0.12}
          strokeWidth={haloWidth}
          strokeLinecap="round"
        />
      ) : null}
      <YarnStrokes strands={strands} />
    </g>
  );
});
