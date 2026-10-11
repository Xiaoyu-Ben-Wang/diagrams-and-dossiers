import { useSyncExternalStore } from "react";

import { POST_IT_COLORS } from "../board/tuning";
import {
  NOTE_FONTS,
  NOTE_STYLES,
  type NoteFont,
  type NoteStyle,
} from "../model/types";
import { NOTE_FONT_DEFAULT } from "../model/kinds";

export const THEMES = ["light", "dark"] as const;
export type ThemeMode = (typeof THEMES)[number];

export const SURFACES = ["cork", "felt", "slate", "whiteboard"] as const;
export type BoardSurface = (typeof SURFACES)[number];

/** What sits on the surface colour: the scaling dot grid, or nothing at all. */
export const BOARD_FINISHES = ["dotted", "clean"] as const;
export type BoardFinish = (typeof BOARD_FINISHES)[number];

import { YARN_STYLES, type YarnStyle } from "../board/yarn-style";
import {
  DEFAULT_YARN_COLOR,
  YARN_COLORS,
  type YarnColor,
} from "../board/yarn-color";

export { YARN_STYLES, type YarnStyle };

/** The palette a new note may be made in, validated on the way out of storage. */
const NOTE_COLORS: readonly string[] = POST_IT_COLORS.map(
  (entry) => entry.color,
);

export interface Preferences {
  theme: ThemeMode;
  surface: BoardSurface;
  finish: BoardFinish;
  yarnStyle: YarnStyle;
  /** What a new string is drawn in, until its own note is used to pick another. */
  yarnColor: YarnColor;
  /** Whether a string throws a shadow onto the board. */
  yarnShadow: boolean;
  /** What the palette's note pad makes, and what its menu starts on. */
  noteStyle: NoteStyle;
  noteColor: string;
  noteFont: NoteFont;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "light",
  surface: "cork",
  finish: "dotted",
  yarnStyle: "realistic",
  yarnColor: DEFAULT_YARN_COLOR,
  yarnShadow: true,
  noteStyle: "plain",
  noteColor: POST_IT_COLORS[0].color,
  noteFont: NOTE_FONT_DEFAULT,
};

interface ThemePalette {
  parchment100: string;
  parchment200: string;
  parchment300: string;
  border: string;
  ink: string;
  inkSoft: string;
  danger: string;
  warning: string;
  /** The brass a pin is pressed from, and the manila a folder is cut from. */
  pin: string;
  boardInk: string;
  boardInkSoft: string;
}

interface SurfaceRamp {
  cork900: string;
  cork700: string;
  cork500: string;
  cork300: string;
  base: string;
  /** The surface's own accent: brass on cork, green on felt, steel on slate. */
  accent: string;
}

/** Dark mirrors the tokens in index.css exactly, so dark + cork is a no-op repaint. */
const THEME_PALETTES: Record<ThemeMode, ThemePalette> = {
  dark: {
    parchment100: "#f7efdd",
    parchment200: "#efe3c8",
    parchment300: "#e3d2ae",
    border: "#c9b48a",
    ink: "#241a12",
    inkSoft: "#4a382a",
    danger: "#8c2f1e",
    warning: "#e8a94a",
    pin: "#d4a83a",
    boardInk: "#f7efdd",
    boardInkSoft: "#e3d2ae",
  },
  light: {
    parchment100: "#fdf9ef",
    parchment200: "#f3ead6",
    parchment300: "#e6dabd",
    border: "#b7a078",
    ink: "#241a12",
    inkSoft: "#4a382a",
    danger: "#8c2f1e",
    warning: "#d98a2b",
    pin: "#a8842a",
    boardInk: "#2b2016",
    boardInkSoft: "#57452f",
  },
};

/**
 * The wool, twice over: the same five, lit for a bright board and lifted for a dark
 * one. A thread dark enough to read on cork disappears into a candlelit room.
 */
const YARN_PALETTES: Record<ThemeMode, Record<YarnColor, string>> = {
  light: {
    crimson: "#a3302b",
    indigo: "#2e4a7d",
    emerald: "#2f6b4f",
    gold: "#b8912f",
    violet: "#5b3a72",
  },
  dark: {
    crimson: "#d9544a",
    indigo: "#5b83c4",
    emerald: "#4fa87a",
    gold: "#dcb44e",
    violet: "#9b6fc4",
  },
};

const SURFACE_RAMPS: Record<BoardSurface, Record<ThemeMode, SurfaceRamp>> = {
  // Cork and leather were one choice wearing two names, and the ramp follows the
  // theme the way the label does: cork in a lit room, dark leather in a dim one.
  cork: {
    dark: {
      cork900: "#1c1511",
      cork700: "#2a1e18",
      cork500: "#3b2a22",
      cork300: "#533c30",
      base: "#3b2a22",
      accent: "#c9a227",
    },
    // Warm and grainy rather than cream: the light room is still a cork room, and
    // the old ramp was pale enough to read as paper. It cannot go much deeper —
    // the base is the board itself, and dark ink on it has to stay readable.
    light: {
      cork900: "#d9bd93",
      cork700: "#e4c9a0",
      cork500: "#efd4ad",
      cork300: "#c3a274",
      base: "#efd4ad",
      accent: "#8a6a12",
    },
  },
  felt: {
    dark: {
      cork900: "#14211a",
      cork700: "#1b3124",
      cork500: "#264432",
      cork300: "#36624a",
      base: "#264432",
      accent: "#7fc48a",
    },
    light: {
      cork900: "#9fbfa6",
      cork700: "#b6cfbb",
      cork500: "#cfe0d2",
      cork300: "#7fa189",
      base: "#cfe0d2",
      accent: "#3d6b3f",
    },
  },
  whiteboard: {
    light: {
      cork900: "#c9ced4",
      cork700: "#dde1e5",
      cork500: "#f7f9fa",
      cork300: "#a8b0b8",
      base: "#f7f9fa",
      accent: "#6c6478",
    },
    // Neutral, not green: the old ramp was green-dominant, which left it a hair
    // from the felt and reading as a darker felt rather than a blackboard. Lifted off
    // true black, which read as a hole rather than a board.
    dark: {
      cork900: "#111113",
      cork700: "#1a1a1c",
      cork500: "#242427",
      cork300: "#38383c",
      base: "#242427",
      accent: "#b9b2c5",
    },
  },
  slate: {
    dark: {
      cork900: "#12161b",
      cork700: "#1c232a",
      cork500: "#2a333d",
      cork300: "#3f4b58",
      base: "#2a333d",
      accent: "#8fb4d9",
    },
    light: {
      cork900: "#b4bcc4",
      cork700: "#c6ccd3",
      cork500: "#dbe0e5",
      cork300: "#8e97a1",
      base: "#dbe0e5",
      accent: "#3f5b7a",
    },
  },
};

/** How much of a card keeps the theme's parchment, the rest being the board it lies on. */
const PAPER_TINT = 0.88;

/** 0.42 rather than 0.5: a mid-grey board wants light dots, not dark ones. */
const DOT_LUMA_THRESHOLD = 0.42;

/** Derived from the surface, not the theme: a whiteboard is white in a dark room. */
export function gridDotFor(surface: BoardSurface, theme: ThemeMode): string {
  const base = SURFACE_RAMPS[surface][theme].base;
  const value = Number.parseInt(base.slice(1), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;

  // Rec. 709 luma, normalised.
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > DOT_LUMA_THRESHOLD
    ? "rgb(20 12 6 / 0.22)"
    : "rgb(255 240 214 / 0.16)";
}

export function surfaceColor(surface: BoardSurface, theme: ThemeMode): string {
  return SURFACE_RAMPS[surface][theme].base;
}

const FOLDER_ACCENT = 0.26;

/**
 * The manila of a folder: the cover a rolled-up page shows, and the tab the palette's
 * page glyph wears. The surface's accent laid thinly over card. The accent is a quarter
 * of the mix rather than half, which turned the cover into varnished brass, and the card
 * is the light room's parchment or the dark room's own deep board — so a folder is a pale
 * manila in one and shadowed in the other, instead of the same brass tan in both.
 */
export function folderColor(surface: BoardSurface, mode: ThemeMode): string {
  const ramp = SURFACE_RAMPS[surface][mode];
  const card =
    mode === "light"
      ? mixHex(THEME_PALETTES.light.parchment300, ramp.base, PAPER_TINT)
      : ramp.cork300;
  return mixHex(ramp.accent, card, FOLDER_ACCENT);
}

/**
 * What is printed on a folder cover. The cover is card in the light room and shadowed in
 * the dark one, so the ink flips with it: the theme's ink in the light room, and in the
 * dark one the paper the dark room writes on, which is the only light thing to hand.
 */
export function folderInk(surface: BoardSurface, mode: ThemeMode): string {
  const palette = THEME_PALETTES[mode];
  return mode === "light"
    ? palette.ink
    : mixHex(
        palette.parchment100,
        SURFACE_RAMPS[surface][mode].base,
        PAPER_TINT,
      );
}

/**
 * The writing surface. Paper in the light room; in the dark one the board's own cork
 * taken down, so it stays darker than the board it is pinned to.
 */
function editorSurface(
  mode: ThemeMode,
  palette: ThemePalette,
  ramp: SurfaceRamp,
): string {
  return mode === "light"
    ? mixHex(palette.parchment100, ramp.base, 0.88)
    : mixHex(ramp.cork900, "#000000", 0.72);
}

/**
 * Ink and edges are drawn towards the board's deep tone; paper is drawn towards the
 * board's own colour, since that is what it is lying on. Ink keeps more of itself than a
 * border does — it has to stay legible, where a hairline only has to read as an edge.
 */
function mixWithBoard(color: string, ramp: SurfaceRamp, weight = 0.78): string {
  return mixHex(color, ramp.cork900, weight);
}

/** Mixing two hexes by weight, worked out here so no value needs CSS to resolve. */
function mixHex(a: string, b: string, aWeight: number): string {
  const channel = (shift: number) => {
    const av = (Number.parseInt(a.slice(1), 16) >> shift) & 255;
    const bv = (Number.parseInt(b.slice(1), 16) >> shift) & 255;
    return Math.round(av * aWeight + bv * (1 - aWeight))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

export function preferenceVariables(
  preferences: Preferences,
): Record<string, string> {
  const theme = THEME_PALETTES[preferences.theme];
  const surface = SURFACE_RAMPS[preferences.surface][preferences.theme];
  return {
    "--color-cork-900": surface.cork900,
    "--color-cork-700": surface.cork700,
    "--color-cork-500": surface.cork500,
    "--color-cork-300": surface.cork300,
    "--color-parchment-100": mixHex(
      theme.parchment100,
      surface.base,
      PAPER_TINT,
    ),
    "--color-parchment-200": mixHex(
      theme.parchment200,
      surface.base,
      PAPER_TINT,
    ),
    "--color-parchment-300": mixHex(
      theme.parchment300,
      surface.base,
      PAPER_TINT,
    ),
    "--color-border": mixWithBoard(theme.border, surface, 0.62),
    "--color-ink": theme.ink,
    "--color-ink-soft": theme.inkSoft,
    "--color-danger": theme.danger,
    "--color-warning": theme.warning,
    "--color-pin": mixWithBoard(theme.pin, surface, 0.85),
    "--color-accent": surface.accent,
    "--color-folder": folderColor(preferences.surface, preferences.theme),
    "--color-folder-ink": folderInk(preferences.surface, preferences.theme),
    "--board-surface": surface.base,
    "--editor-surface": editorSurface(preferences.theme, theme, surface),
    "--grid-dot-color": gridDotFor(preferences.surface, preferences.theme),
    "--color-board-ink": mixWithBoard(theme.boardInk, surface),
    "--color-board-ink-soft": mixWithBoard(theme.boardInkSoft, surface),
    ...Object.fromEntries(
      YARN_COLORS.map((name) => [
        `--color-yarn-${name}`,
        YARN_PALETTES[preferences.theme][name],
      ]),
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePreferences(raw: unknown): Preferences {
  const value = typeof raw === "string" ? tryParse(raw) : raw;
  if (!isRecord(value)) return { ...DEFAULT_PREFERENCES };

  return {
    theme: pick(value.theme, THEMES, DEFAULT_PREFERENCES.theme),
    surface: pick(value.surface, SURFACES, DEFAULT_PREFERENCES.surface),
    finish: pick(value.finish, BOARD_FINISHES, DEFAULT_PREFERENCES.finish),
    yarnStyle: pick(
      value.yarnStyle,
      YARN_STYLES,
      DEFAULT_PREFERENCES.yarnStyle,
    ),
    yarnColor: pick(
      value.yarnColor,
      YARN_COLORS,
      DEFAULT_PREFERENCES.yarnColor,
    ),
    yarnShadow:
      typeof value.yarnShadow === "boolean"
        ? value.yarnShadow
        : DEFAULT_PREFERENCES.yarnShadow,
    noteStyle: pick(
      value.noteStyle,
      NOTE_STYLES,
      DEFAULT_PREFERENCES.noteStyle,
    ),
    noteColor: pick(
      value.noteColor,
      NOTE_COLORS,
      DEFAULT_PREFERENCES.noteColor,
    ),
    noteFont: pick(value.noteFont, NOTE_FONTS, DEFAULT_PREFERENCES.noteFont),
  };
}

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Every field must be named here: `setPreferences` uses this to decide whether
// anything changed, so one left out silently drops the update.
function samePreferences(a: Preferences, b: Preferences): boolean {
  return (
    a.theme === b.theme &&
    a.surface === b.surface &&
    a.finish === b.finish &&
    a.yarnStyle === b.yarnStyle &&
    a.yarnColor === b.yarnColor &&
    a.yarnShadow === b.yarnShadow &&
    a.noteStyle === b.noteStyle &&
    a.noteColor === b.noteColor &&
    a.noteFont === b.noteFont
  );
}

export function applyPreferences(preferences: Preferences): void {
  // Node tests and non-browser render paths have no document to land values on.
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  for (const [property, value] of Object.entries(
    preferenceVariables(preferences),
  )) {
    root.style.setProperty(property, value);
  }

  root.dataset.theme = preferences.theme;
  root.dataset.surface = preferences.surface;
  root.dataset.finish = preferences.finish;
  root.dataset.yarnStyle = preferences.yarnStyle;
  // Scrollbars and form controls follow colorScheme, not any custom property.
  root.style.colorScheme = preferences.theme;

  // Body is repainted directly: the paper ramp is overloaded, so it cannot be flipped.
  if (document.body)
    document.body.style.color = mixWithBoard(
      THEME_PALETTES[preferences.theme].boardInk,
      SURFACE_RAMPS[preferences.surface][preferences.theme],
    );
}

export const PREFERENCE_STORAGE_KEY = "detective-board.preferences";

export function loadPreferences(): Preferences {
  return parsePreferences(readStored());
}

export function savePreferences(preferences: Preferences): void {
  // Touching localStorage can throw (private windows, blocked cookies); every failure reads as nothing saved.
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Swallowed on purpose.
  }
}

function readStored(): unknown {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(PREFERENCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

let currentPreferences: Preferences = loadPreferences();
const listeners = new Set<() => void>();

// Applied at import, not in an effect, so the first paint already carries the stored room.
if (typeof document !== "undefined") applyPreferences(currentPreferences);

export function getPreferences(): Preferences {
  return currentPreferences;
}

export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setPreferences(patch: Partial<Preferences>): Preferences {
  const merged: Record<string, unknown> = { ...currentPreferences };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value;
  }

  const next = parsePreferences(merged);
  if (samePreferences(next, currentPreferences)) return currentPreferences;

  currentPreferences = next;
  applyPreferences(next);
  savePreferences(next);
  for (const listener of listeners) listener();
  return currentPreferences;
}

export function resetPreferences(): Preferences {
  return setPreferences(DEFAULT_PREFERENCES);
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    subscribePreferences,
    getPreferences,
    getPreferences,
  );
}
