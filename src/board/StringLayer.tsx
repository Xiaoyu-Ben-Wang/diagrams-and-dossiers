// `pointer-events-none` throughout, or the yarn on top would swallow clicks meant for the pins
// underneath; the grabbable sag handle is rendered separately by the board.

import type { Ref } from "react";

import { STRING_HALO_PX } from "./tuning";
import type { DrawableString } from "./view";
import { seedFromKey, yarnStrands, type YarnStyle } from "./yarn-style";
import { YARN_COLOR, yarnPath } from "./yarn";
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

export function StringLayer({
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
      {strings.map((string) => (
        <g key={string.id}>
          {selected.has(string.id) || hovered === string.id ? (
            <path
              data-testid="yarn-halo"
              d={yarnPath(string.from, string.to, string.slack)}
              fill="none"
              stroke={YARN_COLOR}
              strokeOpacity={selected.has(string.id) ? 0.22 : 0.12}
              strokeWidth={STRING_HALO_PX / (zoom || 1)}
              strokeLinecap="round"
            />
          ) : null}
          <YarnStrokes
            strands={yarnStrands(
              style,
              string.from,
              string.to,
              string.slack,
              seedFromKey(string.id),
              {
                shadow,
              },
            )}
          />
        </g>
      ))}

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
}
