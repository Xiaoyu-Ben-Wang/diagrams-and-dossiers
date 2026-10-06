import type { Point } from "../board/yarn";
import { seedFromKey, yarnStrands, type YarnStyle } from "../board/yarn-style";
import { YarnStrokes } from "../board/YarnStrokes";
import { usePreferences } from "./preferences";

const WIDTH = 96;
const HEIGHT = 26;
const PAD = 5;

/** Drawn over gauge, so a twist or a plaid band is legible at the size of a row. */
const PREVIEW_WIDTH = 2.2;

/** A level length of the board's own yarn, so a choice is seen rather than approximated. */
export function YarnSample({ style }: { style: YarnStyle }) {
  const { yarnShadow } = usePreferences();
  const from: Point = { x: PAD, y: HEIGHT / 2 };
  const to: Point = { x: WIDTH - PAD, y: HEIGHT / 2 };

  return (
    <svg
      className="prefs-yarn-sample"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      aria-hidden="true"
    >
      <YarnStrokes
        strands={yarnStrands(style, from, to, 0, seedFromKey(style), {
          shadow: yarnShadow,
          width: PREVIEW_WIDTH,
        })}
      />
    </svg>
  );
}
