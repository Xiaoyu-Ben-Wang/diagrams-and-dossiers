import { YARN_COLOR } from "./yarn";
import type { YarnStrand } from "./yarn-style";

/** One `<path>` per drawn pass, in the order the style laid them down. */
export function YarnStrokes({ strands }: { strands: readonly YarnStrand[] }) {
  return (
    <>
      {strands.map((strand, index) => (
        <path
          key={index}
          d={strand.d}
          fill="none"
          stroke={strand.color ?? YARN_COLOR}
          strokeWidth={strand.width}
          strokeOpacity={strand.opacity}
          strokeLinecap={strand.cap ?? "round"}
          strokeDasharray={strand.dash}
          strokeDashoffset={strand.dashOffset}
        />
      ))}
    </>
  );
}
