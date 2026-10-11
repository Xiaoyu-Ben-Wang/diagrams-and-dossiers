// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PREFERENCES,
  SURFACES,
  folderColor,
  folderInk,
  getPreferences,
  preferenceVariables,
  resetPreferences,
  setPreferences,
  surfaceColor,
  type BoardSurface,
} from "./preferences";

afterEach(() => {
  resetPreferences();
});

function indexCss(): string {
  return readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
}

/**
 * Every custom property declared in a `@theme` block, with one level of `var()`
 * resolved. Those blocks are the light + cork default, which `preferenceVariables`
 * must mirror exactly.
 */
function indexCssTokens(): Record<string, string> {
  // Comments first: prose that mentions `@theme` would otherwise open a block.
  const css = indexCss().replace(/\/\*[\s\S]*?\*\//g, "");

  const declared: Record<string, string> = {};
  for (const block of css.matchAll(/@theme[^{]*\{([^}]*)\}/g)) {
    for (const match of (block[1] as string).matchAll(
      /(--[a-z0-9-]+):\s*([^;]+);/gi,
    )) {
      declared[match[1] as string] = (match[2] as string).trim();
    }
  }

  return Object.fromEntries(
    Object.entries(declared).map(([name, value]) => {
      const indirect = /^var\((--[a-z0-9-]+)\)$/.exec(value);
      return [
        name,
        indirect ? (declared[indirect[1] as string] ?? value) : value,
      ];
    }),
  );
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  return (
    (0.2126 * ((value >> 16) & 255) +
      0.7152 * ((value >> 8) & 255) +
      0.0722 * (value & 255)) /
    255
  );
}

/** How far a colour is from grey, as a fraction of full chroma. */
function saturation(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return (Math.max(...channels) - Math.min(...channels)) / 255;
}

/** A custom property declared in a plain `:root` block, which `@theme` is not part of. */
function rootToken(name: string): string | undefined {
  const css = indexCss().replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of css.matchAll(/:root\s*\{([^}]*)\}/g)) {
    const match = new RegExp(`(?:^|;)\\s*${name}:\\s*([^;]+);`).exec(
      block[1] as string,
    );
    if (match) return (match[1] as string).trim();
  }
  return undefined;
}

describe("applyPreferences in a document", () => {
  it("writes every preference token as a custom property on the root", () => {
    setPreferences({
      theme: "light",
      surface: "whiteboard",
      yarnStyle: "realistic",
    });

    const root = document.documentElement;
    const expected = preferenceVariables(getPreferences());
    for (const [property, value] of Object.entries(expected)) {
      expect(root.style.getPropertyValue(property), property).toBe(value);
    }

    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.surface).toBe("whiteboard");
    expect(root.dataset.yarnStyle).toBe("realistic");
    expect(root.dataset.finish).toBe("dotted");
  });

  it("carries the finish through to the root, so the stylesheet can read it", () => {
    const root = document.documentElement;
    setPreferences({ finish: "clean" });
    expect(root.dataset.finish).toBe("clean");

    setPreferences({ finish: "dotted" });
    expect(root.dataset.finish).toBe("dotted");
  });

  it("repaints when a surface changes", () => {
    setPreferences({ surface: "whiteboard" });
    const whiteboard =
      document.documentElement.style.getPropertyValue("--color-cork-500");

    setPreferences({ surface: "slate" });
    expect(
      document.documentElement.style.getPropertyValue("--color-cork-500"),
    ).not.toBe(whiteboard);
  });

  it("defaults light cork to exactly what index.css declares", () => {
    const tokens = indexCssTokens();
    const applied = preferenceVariables(DEFAULT_PREFERENCES);

    // A first visit never opens the drawer, so the default must equal index.css exactly.
    for (const [property, value] of Object.entries(applied)) {
      const declared = tokens[property];
      if (declared === undefined) continue; // grid-dot-color is written at runtime only
      expect(value.toLowerCase(), property).toBe(declared);
    }
    // Chrome text sits on the cork, not on the parchment index.css keeps for pages:
    // in the light room that is a dark ink, and the parchment tone would vanish.
    expect(applied["--color-board-ink"]).not.toBe(
      tokens["--color-parchment-100"],
    );
    expect(luminance(applied["--color-board-ink"] as string)).toBeLessThan(0.3);
  });

  it("writes every token index.css declares, so none is left at the default", () => {
    const applied = preferenceVariables(DEFAULT_PREFERENCES);

    for (const name of Object.keys(indexCssTokens())) {
      expect(applied[name], name).toBeDefined();
    }
  });

  it("overrides tokens per selection only through the writer, not in the stylesheet", () => {
    // A `:root[data-…] { --token: … }` block is how one theme silently ignores the
    // surface the writer chose; `index.css` keeps none.
    for (const block of indexCss().matchAll(
      /:root\[data-[a-z-]+="[^"]+"\]\s*\{([^}]*)\}/g,
    )) {
      expect(block[1]?.includes("--"), block[0].slice(0, 48)).toBe(false);
    }
  });

  it("makes light mode a pale board with dark ink rather than dark mode brightened", () => {
    const light = preferenceVariables({
      ...DEFAULT_PREFERENCES,
      theme: "light",
    });
    const dark = preferenceVariables({ ...DEFAULT_PREFERENCES, theme: "dark" });

    expect(light["--color-parchment-100"]).not.toBe(
      dark["--color-parchment-100"],
    );
    expect(luminance(light["--board-surface"] as string)).toBeGreaterThan(0.6);
    expect(luminance(light["--color-board-ink"] as string)).toBeLessThan(0.3);
  });

  it("gives every surface a pale light variant distinct from its dark one", () => {
    for (const surface of SURFACES) {
      expect(surfaceColor(surface as BoardSurface, "light"), surface).not.toBe(
        surfaceColor(surface as BoardSurface, "dark"),
      );
      expect(
        luminance(surfaceColor(surface as BoardSurface, "light")),
        surface,
      ).toBeGreaterThan(0.6);
    }
  });

  it("folds a paler folder in the light room than in the dark one", () => {
    for (const surface of SURFACES) {
      const light = folderColor(surface as BoardSurface, "light");
      const dark = folderColor(surface as BoardSurface, "dark");
      expect(luminance(light), surface).toBeGreaterThan(0.6);
      expect(luminance(dark), surface).toBeLessThan(0.5);
    }
  });

  it("folds it out of card, not out of the pin's brass", () => {
    for (const surface of SURFACES) {
      for (const mode of ["light", "dark"] as const) {
        const folder = folderColor(surface as BoardSurface, mode);
        const brass = preferenceVariables({
          ...DEFAULT_PREFERENCES,
          surface: surface as BoardSurface,
          theme: mode,
        })["--color-pin"] as string;
        expect(saturation(folder), `${surface} ${mode}`).toBeLessThan(
          saturation(brass),
        );
      }
    }
  });

  it("inks the folder against its cover, whichever way the cover leans", () => {
    for (const surface of SURFACES) {
      const lightInk = luminance(folderInk(surface as BoardSurface, "light"));
      const darkInk = luminance(folderInk(surface as BoardSurface, "dark"));
      expect(lightInk, surface).toBeLessThan(
        luminance(folderColor(surface as BoardSurface, "light")),
      );
      expect(darkInk, surface).toBeGreaterThan(
        luminance(folderColor(surface as BoardSurface, "dark")),
      );
      expect(Math.abs(darkInk - lightInk), surface).toBeGreaterThan(0.5);
    }
  });

  it("declares the default folder in index.css, so a first visit never repaints it", () => {
    expect(rootToken("--color-folder")).toBe(folderColor("cork", "light"));
    expect(rootToken("--color-folder-ink")).toBe(folderInk("cork", "light"));
  });
});
