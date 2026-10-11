import { describe, expect, it } from "vitest";

import {
  DEFAULT_YARN_COLOR,
  YARN_COLORS,
  isYarnColor,
  yarnColorCss,
  yarnColorLabel,
} from "./yarn-color";

describe("yarn colour", () => {
  it("defaults to a colour it can also name", () => {
    expect(YARN_COLORS).toContain(DEFAULT_YARN_COLOR);
  });

  it("gives every colour its own token", () => {
    const tokens = YARN_COLORS.map((color) => yarnColorCss(color));
    expect(new Set(tokens).size).toBe(YARN_COLORS.length);
    expect(yarnColorCss("indigo")).toBe("var(--color-yarn-indigo)");
  });

  it("draws anything it cannot name in the default", () => {
    for (const stored of [undefined, "", "#a3302b", "chartreuse", "Crimson"]) {
      expect(yarnColorCss(stored)).toBe(yarnColorCss(DEFAULT_YARN_COLOR));
    }
  });

  it("recognises the palette and nothing else", () => {
    for (const color of YARN_COLORS) expect(isYarnColor(color)).toBe(true);
    expect(isYarnColor("#a3302b")).toBe(false);
    expect(isYarnColor(undefined)).toBe(false);
  });

  it("labels a colour for the swatch", () => {
    expect(yarnColorLabel("emerald")).toBe("Emerald");
  });
});
