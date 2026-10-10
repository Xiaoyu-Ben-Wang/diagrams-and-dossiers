/** The wool a string may be drawn in. Each name is one token in index.css. */
export const YARN_COLORS = [
  "crimson",
  "indigo",
  "emerald",
  "gold",
  "violet",
] as const;
export type YarnColor = (typeof YARN_COLORS)[number];

/** What a string is drawn in until somebody picks otherwise; the column's own default. */
export const DEFAULT_YARN_COLOR: YarnColor = "crimson";

/**
 * The paint, named rather than valued: `.yarn-paint` in index.css derives every shade from
 * `--yarn-base`, which a string overrides inline with its own colour.
 */
export const YARN_BASE = "var(--yarn-base)";
export const YARN_DEEP = "var(--yarn-deep)";
export const YARN_LIT = "var(--yarn-lit)";
export const YARN_ROSE = "var(--yarn-rose)";
export const YARN_CREAM = "var(--yarn-cream)";
export const YARN_CAST = "var(--yarn-cast)";

export function isYarnColor(value: unknown): value is YarnColor {
  return (YARN_COLORS as readonly unknown[]).includes(value);
}

/** A stored string may name a colour, hold one from before the palette, or hold nothing. */
export function yarnColorCss(color: string | undefined): string {
  return `var(--color-yarn-${isYarnColor(color) ? color : DEFAULT_YARN_COLOR})`;
}

export function yarnColorLabel(color: YarnColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}
