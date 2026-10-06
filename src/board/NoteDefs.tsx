// The crumple patterns a post-it can be folded with.
//
// Turbulence lit from one side, which is the only native way to draw crumpled
// paper: the creases are shading, not lines, so they read as folds in a sheet
// rather than as a few strokes across it. No library does this — the two on npm
// that come near it either tear paper rather than crumple it, or ship no build.
//
// This block must stay inside the world layer. The PNG export clones that
// subtree into an SVG `data:` URI, and a filter reference only resolves against
// a definition in the same document — so a defs block left outside it would
// quietly export every note as flat paper.

import { CRUMPLE_VARIANTS } from "../model/kinds";

/** Fixed per variant: the noise's own seed, which is what makes them differ. */
const SEEDS = [11, 47, 83, 129, 197, 263];

export function NoteDefs() {
  return (
    <svg
      aria-hidden="true"
      width="0"
      height="0"
      // Out of the flow and unclickable, but still in the world for the clone.
      style={{ position: "absolute", pointerEvents: "none" }}
    >
      <defs>
        {SEEDS.slice(0, CRUMPLE_VARIANTS).map((seed, index) => (
          <filter
            key={seed}
            id={crumpleFilterId(index)}
            x="0"
            y="0"
            width="100%"
            height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.05"
              numOctaves="3"
              seed={seed}
              result="noise"
            />
            <feDiffuseLighting
              in="noise"
              lightingColor="#ffffff"
              surfaceScale="2.4"
              result="lit"
            >
              <feDistantLight azimuth="45" elevation="50" />
            </feDiffuseLighting>
            {/* Multiply, so the note's own colour survives the shading... */}
            <feBlend
              mode="multiply"
              in="lit"
              in2="SourceGraphic"
              result="shaded"
            />
            {/* ...and `in`, so the lighting's rectangle cannot spill past the paper. */}
            <feComposite in="shaded" in2="SourceGraphic" operator="in" />
          </filter>
        ))}
      </defs>
    </svg>
  );
}

export function crumpleFilterId(variant: number): string {
  return `note-crumple-${variant}`;
}
