import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXPORT_LIMITS,
  EXPORT_MARGIN,
  backgroundFor,
  exportBounds,
  imageFileName,
  outputSize,
  patternFor,
  planExport,
  type ExportBackground,
  type ExportLimits,
} from "./export-image";
import { gridDotFor, surfaceColor } from "../theme/preferences";
import type { BoardState } from "./store";

const rect = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
});

const BOARD: BoardState = {
  entities: [
    {
      id: "a",
      kind: "article",
      title: "The Drowned Bell",
      bodyMd: "",
      visibility: "shared",
      status: "theory",
      dateInherit: true,
      nudge: { x: 0, y: 0 },
      zIndex: 0,
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      board: { x: 0, y: 0 },
      rotation: 0,
      options: {
        width: 720,
        typeScale: "normal",
        paper: "parchment",
        titleBar: true,
        editable: true,
        acceptsPins: true,
        collapsible: false,
        collapsed: false,
      },
    },
  ],
  strings: [],
};

describe("the bounds of an export", () => {
  it("unions everything and adds the margin", () => {
    const bounds = exportBounds([rect(0, 0, 100, 50), rect(200, 100, 100, 50)]);

    expect(bounds).toEqual({
      x: -EXPORT_MARGIN,
      y: -EXPORT_MARGIN,
      width: 300 + EXPORT_MARGIN * 2,
      height: 150 + EXPORT_MARGIN * 2,
    });
  });

  it("is null for an empty board, rather than a rect at the origin", () => {
    expect(exportBounds([])).toBeNull();
  });

  it("is null rather than infinite when a rect is not finite", () => {
    expect(exportBounds([rect(NaN, 0, 10, 10)])).toBeNull();
  });
});

describe("how many pixels", () => {
  it("multiplies the board by the scale", () => {
    expect(outputSize(rect(0, 0, 100, 40), 2)).toEqual({
      width: 200,
      height: 80,
    });
  });

  it("rounds up, so the last row of pixels is included", () => {
    expect(outputSize(rect(0, 0, 10.2, 10.2), 1)).toEqual({
      width: 11,
      height: 11,
    });
  });
});

describe("planning an export", () => {
  it("takes the requested scale when it fits", () => {
    const plan = planExport([rect(0, 0, 100, 100)], 2);

    expect(plan?.scale).toBe(2);
    expect(plan?.clamped).toBe(false);
    expect(plan).toMatchObject({ width: 2 * (100 + EXPORT_MARGIN * 2) });
  });

  it("clamps the scale on a board too large to draw, and says it did", () => {
    // 3000x2000 at 3x is 54 Mpx. Refusing to export is worse than exporting
    // the largest picture that fits, as long as the caller can say so.
    const limits: ExportLimits = { maxPixels: 32_000_000, maxEdge: 12_000 };
    const plan = planExport(
      [rect(0, 0, 3000 - EXPORT_MARGIN * 2, 2000 - EXPORT_MARGIN * 2)],
      3,
      limits,
    );

    expect(plan?.clamped).toBe(true);
    expect(plan!.scale).toBeLessThan(3);
    expect(plan!.width * plan!.height).toBeLessThanOrEqual(limits.maxPixels);
  });

  it("clamps on the edge limit as well as the area", () => {
    // A board that is one very long strip: 60000x200 is inside the area budget
    // at 1x and far outside what a canvas will hold on one side.
    const plan = planExport([rect(0, 0, 60_000, 200)], 1);

    expect(plan!.width).toBeLessThanOrEqual(DEFAULT_EXPORT_LIMITS.maxEdge);
    expect(plan?.clamped).toBe(true);
  });

  it("is null when there is nothing to draw", () => {
    expect(planExport([], 2)).toBeNull();
  });

  it("falls back to the default scale when asked for nonsense", () => {
    expect(planExport([rect(0, 0, 100, 100)], Number.NaN)?.scale).toBe(2);
    expect(planExport([rect(0, 0, 100, 100)], -4)?.scale).toBe(2);
  });
});

describe("the background", () => {
  const choice = (over: Partial<ExportBackground> = {}): ExportBackground => ({
    fill: "surface",
    surface: "cork",
    custom: "#123456",
    pattern: "plain",
    ...over,
  });

  it("gives nothing at all for transparent, so the PNG keeps its alpha", () => {
    expect(backgroundFor(choice({ fill: "transparent" }), "dark")).toBeNull();
  });

  it("paints the board’s own surface, whichever one is chosen", () => {
    expect(backgroundFor(choice(), "dark")).toBe(surfaceColor("cork", "dark"));
    expect(backgroundFor(choice({ surface: "felt" }), "dark")).toBe(
      surfaceColor("felt", "dark"),
    );
    // The surface, not the theme: a whiteboard is white in a dark room.
    expect(backgroundFor(choice({ surface: "whiteboard" }), "dark")).toBe(
      surfaceColor("whiteboard", "dark"),
    );
  });

  it("paints a flat colour", () => {
    expect(backgroundFor(choice({ fill: "white" }), "dark")).toBe("#ffffff");
    expect(backgroundFor(choice({ fill: "black" }), "dark")).toBe("#000000");
  });

  it("takes a custom colour, and falls back rather than trusting one", () => {
    expect(
      backgroundFor(choice({ fill: "custom", custom: "#abcdef" }), "dark"),
    ).toBe("#abcdef");
    expect(
      backgroundFor(choice({ fill: "custom", custom: "not a colour" }), "dark"),
    ).toBe(surfaceColor("cork", "dark"));
  });
});

describe("the dot motif", () => {
  const choice = (over: Partial<ExportBackground> = {}): ExportBackground => ({
    fill: "surface",
    surface: "cork",
    custom: "#123456",
    pattern: "plain",
    ...over,
  });

  it("is absent when the background is plain", () => {
    expect(patternFor(choice(), "dark")).toBeNull();
  });

  it("is the board’s own dots when asked for", () => {
    const dots = patternFor(choice({ pattern: "dots" }), "dark");

    expect(dots).toContain("radial-gradient");
    // Tinted for the surface it is drawn on, so a whiteboard gets dark dots.
    expect(dots).toContain(gridDotFor("cork", "dark"));
    expect(
      patternFor(choice({ pattern: "dots", surface: "whiteboard" }), "dark"),
    ).toContain(gridDotFor("whiteboard", "dark"));
  });
});

describe("the file name", () => {
  it("is the board file name with a png on it", () => {
    expect(imageFileName(BOARD)).toBe("the-drowned-bell.png");
  });

  it("falls back to a name when no page can lend one", () => {
    expect(imageFileName({ entities: [], strings: [] })).toBe("case-board.png");
  });
});
