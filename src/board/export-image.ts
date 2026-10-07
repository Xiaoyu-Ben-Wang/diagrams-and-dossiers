/**
 * What an image export is, decided before anything is rendered: which part of
 * the board, how many pixels, on what colour. Pure, so the arithmetic is
 * testable without a browser.
 *
 * See `docs/export-image.md` for the pipeline these numbers feed.
 */

import { boardFileName, DEFAULT_BOARD_FILE_NAME } from "./board-file";
import {
  gridDotFor,
  surfaceColor,
  type BoardSurface,
  type ThemeMode,
} from "../theme/preferences";
import { GRID_BASE_SPACING } from "./grid";
import type { BoardState } from "./store";
import type { Rect } from "./camera";

export type ExportFill =
  "surface" | "white" | "black" | "transparent" | "custom";

/** The board's own surface, or a flat colour, or nothing at all. */
export const EXPORT_FILLS: readonly ExportFill[] = [
  "surface",
  "white",
  "black",
  "transparent",
  "custom",
];

/** Whether the board's dot motif is drawn on the background. */
export type ExportPattern = "plain" | "dots";

export interface ExportBackground {
  fill: ExportFill;
  surface: BoardSurface;
  /** Used when the fill is `custom`. */
  custom: string;
  pattern: ExportPattern;
}

/** Board px between dots: the exported board is drawn on the grid's own pitch. */
export const EXPORT_DOT_TILE = GRID_BASE_SPACING;

/** Device pixels per board pixel. Independent of the screen's own DPR. */
export const EXPORT_SCALES = [0.5, 1, 2, 3] as const;
export type ExportScale = (typeof EXPORT_SCALES)[number];

export const DEFAULT_EXPORT_SCALE: ExportScale = 2;

/**
 * Board px of margin around the board's own bounds, for shadows, pin tags and
 * sag. Measured with `/tmp/yarn2/export-margin-measure.js`: the furthest
 * decoration on the demo board reaches 95px past the entity boxes, so the 48
 * this started at cropped the top off a tag and its yarn.
 */
export const EXPORT_MARGIN = 128;

/**
 * Caps on the output canvas.
 *
 * A canvas has a hard maximum, and a board of two hundred notes at 3× is over
 * it. The scale is reduced to fit rather than the export being refused, so
 * `MAX_EXPORT_PIXELS` is a budget the caller is told about, not a limit.
 */
export const MAX_EXPORT_PIXELS = 32_000_000;
export const MAX_EXPORT_EDGE = 12_000;

export interface ExportLimits {
  maxPixels: number;
  maxEdge: number;
}

export const DEFAULT_EXPORT_LIMITS: ExportLimits = {
  maxPixels: MAX_EXPORT_PIXELS,
  maxEdge: MAX_EXPORT_EDGE,
};

export interface ExportPlan {
  bounds: Rect;
  /** Effective device px per board px, after clamping. */
  scale: number;
  width: number;
  height: number;
  requested: number;
  /** True when `scale` is below what was asked for. */
  clamped: boolean;
}

/** The union of everything to be drawn, plus the margin. Null if there is nothing. */
export function exportBounds(
  rects: readonly Rect[],
  margin = EXPORT_MARGIN,
): Rect | null {
  if (rects.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;

  return {
    x: minX - margin,
    y: minY - margin,
    width: maxX - minX + margin * 2,
    height: maxY - minY + margin * 2,
  };
}

export function outputSize(
  bounds: Rect,
  scale: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.ceil(bounds.width * scale)),
    height: Math.max(1, Math.ceil(bounds.height * scale)),
  };
}

/**
 * The largest scale at or below `requested` that fits the budget.
 *
 * Measured against a board one pixel wider and taller than it is, because
 * `outputSize` rounds up and the rounding happens after the fit: without the
 * slack, a scale that fits exactly comes back one row over the budget.
 */
function fitScale(
  bounds: Rect,
  requested: number,
  limits: ExportLimits,
): number {
  const width = bounds.width + 1;
  const height = bounds.height + 1;
  if (width <= 1 || height <= 1) return requested;
  const byPixels = Math.sqrt(limits.maxPixels / (width * height));
  const byEdge = limits.maxEdge / Math.max(width, height);
  return Math.min(requested, byPixels, byEdge);
}

/**
 * Everything the renderer needs, or null when there is nothing on the board.
 *
 * The scale comes back as a number rather than one of `EXPORT_SCALES`: a board
 * too large for its requested scale gets the largest that fits, and the dialog
 * says so. Refusing to export a big board, or silently exporting a different
 * one, are both worse than a number the caller can put on screen.
 */
export function planExport(
  rects: readonly Rect[],
  requested: number,
  limits: ExportLimits = DEFAULT_EXPORT_LIMITS,
  margin = EXPORT_MARGIN,
): ExportPlan | null {
  const bounds = exportBounds(rects, margin);
  if (!bounds) return null;

  const wanted =
    Number.isFinite(requested) && requested > 0
      ? requested
      : DEFAULT_EXPORT_SCALE;
  const scale = fitScale(bounds, wanted, limits);
  const size = outputSize(bounds, scale);

  return {
    bounds,
    scale,
    width: size.width,
    height: size.height,
    requested: wanted,
    clamped: scale < wanted - 1e-6,
  };
}

/** What the background paints, or null for an alpha PNG. */
export function backgroundFor(
  choice: ExportBackground,
  theme: ThemeMode,
): string | null {
  const own = surfaceColor(choice.surface, theme);
  switch (choice.fill) {
    case "transparent":
      return null;
    case "white":
      return "#ffffff";
    case "black":
      return "#000000";
    case "custom":
      return isColour(choice.custom) ? choice.custom : own;
    case "surface":
      return own;
  }
}

/** A value an attribute or a CSS declaration can take, rather than a colour name. */
function isColour(value: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(value) || /^[a-z]{3,20}$/i.test(value);
}

/**
 * The dot motif as a CSS background-image, or null when the background is
 * plain.
 *
 * The same dots the board draws, tinted by `gridDotFor` so a whiteboard gets
 * dark dots and a slate board light ones. Board space, anchored to the export's
 * own corner: the live grid is viewport chrome that shifts as the camera moves,
 * and an export that moved with the camera would not be reproducible.
 */
export function patternFor(
  choice: ExportBackground,
  theme: ThemeMode,
): string | null {
  if (choice.pattern !== "dots") return null;
  return `radial-gradient(circle at center, ${gridDotFor(choice.surface, theme)} 0 1px, transparent 1.8px)`;
}

/** The board's file name with a `.png` on it. */
export function imageFileName(board: BoardState): string {
  const json = boardFileName(board);
  return json === DEFAULT_BOARD_FILE_NAME
    ? "case-board.png"
    : json.replace(/\.json$/, ".png");
}
