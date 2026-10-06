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

import { YARN_STYLES, type YarnStyle } from "../board/yarn-style";

export { YARN_STYLES, type YarnStyle };

/** The palette a new note may be made in, validated on the way out of storage. */
const NOTE_COLORS: readonly string[] = POST_IT_COLORS.map(
  (entry) => entry.color,
);

export interface Preferences {
  theme: ThemeMode;
  surface: BoardSurface;
  yarnStyle: YarnStyle;
  /** Whether a string throws a shadow onto the board. */
  yarnShadow: boolean;
  /** What the palette's note pad makes, and what its menu starts on. */
  noteStyle: NoteStyle;
  noteColor: string;
  noteFont: NoteFont;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "dark",
  surface: "cork",
  yarnStyle: "minimal",
  yarnShadow: true,
  noteStyle: "plain",
  noteColor: POST_IT_COLORS[0].color,
  noteFont: NOTE_FONT_DEFAULT,
};

interface ThemePalette {
  parchment100: string;
  parchment200: string;
  parchment300: string;
  parchmentEdge: string;
  ink: string;
  inkSoft: string;
  wax: string;
  brass: string;
  boardInk: string;
  boardInkSoft: string;
}

interface SurfaceRamp {
  cork900: string;
  cork700: string;
  cork500: string;
  cork300: string;
  base: string;
}

/** Dark mirrors the tokens in index.css exactly, so dark + cork is a no-op repaint. */
const THEME_PALETTES: Record<ThemeMode, ThemePalette> = {
  dark: {
    parchment100: "#f7efdd",
    parchment200: "#efe3c8",
    parchment300: "#e3d2ae",
    parchmentEdge: "#c9b48a",
    ink: "#241a12",
    inkSoft: "#4a382a",
    wax: "#8c2f1e",
    brass: "#c9a227",
    boardInk: "#f7efdd",
    boardInkSoft: "#e3d2ae",
  },
  light: {
    parchment100: "#fdf9ef",
    parchment200: "#f3ead6",
    parchment300: "#e6dabd",
    parchmentEdge: "#b7a078",
    ink: "#241a12",
    inkSoft: "#4a382a",
    wax: "#8c2f1e",
    // Brass at full brightness is unreadable on paper; same hue, taken down.
    brass: "#8a6a12",
    boardInk: "#2b2016",
    boardInkSoft: "#57452f",
  },
};

const SURFACE_RAMPS: Record<BoardSurface, Record<ThemeMode, SurfaceRamp>> = {
  // Cork and leather were one choice wearing two names, and the ramp follows the
  // theme the way the label does: cork in a lit room, dark leather in a dim one.
  cork: {
    dark: {
      cork900: "#140d09",
      cork700: "#221610",
      cork500: "#33221a",
      cork300: "#4b3428",
      base: "#33221a",
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
    },
  },
  felt: {
    dark: {
      cork900: "#0c1912",
      cork700: "#13291c",
      cork500: "#1e3c2a",
      cork300: "#2e5a42",
      base: "#1e3c2a",
    },
    light: {
      cork900: "#9fbfa6",
      cork700: "#b6cfbb",
      cork500: "#cfe0d2",
      cork300: "#7fa189",
      base: "#cfe0d2",
    },
  },
  whiteboard: {
    light: {
      cork900: "#c9ced4",
      cork700: "#dde1e5",
      cork500: "#f7f9fa",
      cork300: "#a8b0b8",
      base: "#f7f9fa",
    },
    // Neutral, not green: the old ramp was green-dominant, which left it a hair
    // from the felt and reading as a darker felt rather than a blackboard.
    dark: {
      cork900: "#080809",
      cork700: "#111112",
      cork500: "#1b1b1d",
      cork300: "#2e2e31",
      base: "#1b1b1d",
    },
  },
  slate: {
    dark: {
      cork900: "#12161b",
      cork700: "#1c232a",
      cork500: "#2a333d",
      cork300: "#3f4b58",
      base: "#2a333d",
    },
    light: {
      cork900: "#b4bcc4",
      cork700: "#c6ccd3",
      cork500: "#dbe0e5",
      cork300: "#8e97a1",
      base: "#dbe0e5",
    },
  },
};

/** Derived from the surface, not the theme: a whiteboard is white in a dark room. */
export function gridDotFor(surface: BoardSurface, theme: ThemeMode): string {
  const base = SURFACE_RAMPS[surface][theme].base;
  const value = Number.parseInt(base.slice(1), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;

  // Rec. 709 luma, normalised. 0.42 not 0.5: a mid-grey board wants light dots.
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.42 ? "rgb(20 12 6 / 0.22)" : "rgb(255 240 214 / 0.16)";
}

export function surfaceColor(surface: BoardSurface, theme: ThemeMode): string {
  return SURFACE_RAMPS[surface][theme].base;
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
    "--color-parchment-100": theme.parchment100,
    "--color-parchment-200": theme.parchment200,
    "--color-parchment-300": theme.parchment300,
    "--color-parchment-edge": theme.parchmentEdge,
    "--color-ink": theme.ink,
    "--color-ink-soft": theme.inkSoft,
    "--color-wax": theme.wax,
    "--color-brass": theme.brass,
    "--board-surface": surface.base,
    "--grid-dot-color": gridDotFor(preferences.surface, preferences.theme),
    "--color-board-ink": theme.boardInk,
    "--color-board-ink-soft": theme.boardInkSoft,
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
    yarnStyle: pick(
      value.yarnStyle,
      YARN_STYLES,
      DEFAULT_PREFERENCES.yarnStyle,
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
    a.yarnStyle === b.yarnStyle &&
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
  root.dataset.yarnStyle = preferences.yarnStyle;
  // Scrollbars and form controls follow colorScheme, not any custom property.
  root.style.colorScheme = preferences.theme;

  // Body is repainted directly: the paper ramp is overloaded, so it cannot be flipped.
  if (document.body)
    document.body.style.color = THEME_PALETTES[preferences.theme].boardInk;
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
