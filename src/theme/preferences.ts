/**
 * Preferences: the room the board is read in.
 *
 * Three independent choices — theme, board surface, yarn style — that say
 * nothing about the board's contents. They are expressed as CSS custom
 * properties on <html> rather than threaded through props, so canvas code, DOM
 * code and plain stylesheet rules all resolve the same values, and they persist
 * to localStorage so a player's board looks like their board next session.
 *
 * Every path that touches storage is total. A corrupt entry, a blocked store or
 * a revoked permission degrades to defaults; preferences must never be able to
 * take the board down with them.
 */

import { useSyncExternalStore } from 'react'

export const THEMES = ['light', 'dark'] as const
export type ThemeMode = (typeof THEMES)[number]

export const SURFACES = ['cork', 'leather', 'felt', 'slate', 'whiteboard'] as const
export type BoardSurface = (typeof SURFACES)[number]

/**
 * Deliberately duplicated rather than imported from src/board/yarn-style.ts.
 * That module is being written alongside this one and may not exist yet; the
 * preference only needs to name the two styles, and the renderer is what gives
 * them meaning. Keep in sync by hand if a third style ever lands.
 */
export const YARN_STYLES = ['minimal', 'realistic'] as const
export type YarnStyle = (typeof YARN_STYLES)[number]

export interface Preferences {
  theme: ThemeMode
  surface: BoardSurface
  yarnStyle: YarnStyle
}

/** What the board rendered before preferences existed, so a first visit is unchanged. */
export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark',
  surface: 'cork',
  yarnStyle: 'minimal',
}

interface ThemePalette {
  parchment100: string
  parchment200: string
  parchment300: string
  parchmentEdge: string
  ink: string
  inkSoft: string
  wax: string
  brass: string
  /**
   * Text drawn straight onto the board rather than onto paper. It needs its own
   * name because components currently write chrome text with `text-parchment-*`,
   * which is the *paper* ramp — correct on a dark board, invisible on a pale
   * one. This token is the one to migrate those to.
   */
  boardInk: string
  boardInkSoft: string
}

interface SurfaceRamp {
  cork900: string
  cork700: string
  cork500: string
  cork300: string
  /** The single colour a renderer would paint the whole board with. */
  base: string
}

/**
 * Dark mirrors the tokens in index.css exactly, so "dark + cork" is a no-op
 * repaint on a board that never opens preferences.
 *
 * Light is a well-lit study, not the dark theme brightened: the board becomes
 * pale linen, paper stays paper and ink stays dark. Only the room changes.
 */
const THEME_PALETTES: Record<ThemeMode, ThemePalette> = {
  dark: {
    parchment100: '#f7efdd',
    parchment200: '#efe3c8',
    parchment300: '#e3d2ae',
    parchmentEdge: '#c9b48a',
    ink: '#241a12',
    inkSoft: '#4a382a',
    wax: '#8c2f1e',
    brass: '#c9a227',
    boardInk: '#f7efdd',
    boardInkSoft: '#e3d2ae',
  },
  light: {
    parchment100: '#fdf9ef',
    parchment200: '#f3ead6',
    parchment300: '#e6dabd',
    parchmentEdge: '#b7a078',
    ink: '#241a12',
    inkSoft: '#4a382a',
    wax: '#8c2f1e',
    // Brass at full brightness is unreadable on paper; this is the same hue
    // taken down until thin rules and small text hold their contrast.
    brass: '#8a6a12',
    boardInk: '#2b2016',
    boardInkSoft: '#57452f',
  },
}

/**
 * Each surface swaps the four cork tokens, which is what every board-facing
 * class actually paints with, plus a base colour for canvas renderers that
 * would rather not read four gradients out of computed styles.
 *
 * Cork is the colour, not the speckled texture: the board's texture is the
 * grid, the dust and the candlelight, all of which move with the camera. A
 * static grain underneath them reads as a second, broken grid.
 *
 * The light variants are not dimmed dark ones: the same board in a lit room is
 * genuinely paler, not the dark one with the brightness turned up.
 */
const SURFACE_RAMPS: Record<BoardSurface, Record<ThemeMode, SurfaceRamp>> = {
  cork: {
    dark: { cork900: '#2e1f14', cork700: '#4a3320', cork500: '#6b4a2f', cork300: '#8c6544', base: '#6b4a2f' },
    light: { cork900: '#d9cdb3', cork700: '#e4dac3', cork500: '#f0e8d4', cork300: '#cdbc9b', base: '#f0e8d4' },
  },
  leather: {
    dark: { cork900: '#140d09', cork700: '#221610', cork500: '#33221a', cork300: '#4b3428', base: '#33221a' },
    light: { cork900: '#c3ae96', cork700: '#d3c0a8', cork500: '#e5d6c1', cork300: '#a68f76', base: '#e5d6c1' },
  },
  felt: {
    dark: { cork900: '#0c1912', cork700: '#13291c', cork500: '#1e3c2a', cork300: '#2e5a42', base: '#1e3c2a' },
    light: { cork900: '#9fbfa6', cork700: '#b6cfbb', cork500: '#cfe0d2', cork300: '#7fa189', base: '#cfe0d2' },
  },
  /**
   * The only surface that changes material with the theme rather than just
   * getting lighter: a whiteboard under a light theme is a whiteboard, and
   * under a dark one it is the blackboard next to it. Both are the same board —
   * a writable panel — which is why they share one option instead of being two.
   */
  whiteboard: {
    // Whiteboard. Chrome stays slightly cooler than the board so the top bar
    // does not dissolve into it.
    light: { cork900: '#c9ced4', cork700: '#dde1e5', cork500: '#f7f9fa', cork300: '#a8b0b8', base: '#f7f9fa' },
    // Blackboard: chalkboard green-black, not pure black. Pure black reads as
    // switched-off screen; a chalkboard has colour in it.
    dark: { cork900: '#0a0e0c', cork700: '#131a16', cork500: '#1e2a24', cork300: '#33443b', base: '#1e2a24' },
  },
  slate: {
    dark: { cork900: '#12161b', cork700: '#1c232a', cork500: '#2a333d', cork300: '#3f4b58', base: '#2a333d' },
    light: { cork900: '#b4bcc4', cork700: '#c6ccd3', cork500: '#dbe0e5', cork300: '#8e97a1', base: '#dbe0e5' },
  },
}

/**
 * A grid-dot colour that reads against whatever the board is.
 *
 * Derived from the surface rather than from the theme, because those disagree
 * on exactly the surface that matters: a whiteboard is white in a dark room, so
 * a theme-derived dot would be light-on-light and vanish. Luminance decides,
 * which also means a surface added later gets a sensible grid for free.
 */
export function gridDotFor(surface: BoardSurface, theme: ThemeMode): string {
  const base = SURFACE_RAMPS[surface][theme].base
  const value = Number.parseInt(base.slice(1), 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff

  // Rec. 709 luma, normalised. The threshold is deliberately not 0.5 — a
  // mid-grey board wants light dots, and it only takes a slight darkening
  // before a dark dot stops reading at all.
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luma > 0.42 ? 'rgb(20 12 6 / 0.22)' : 'rgb(255 240 214 / 0.16)'
}

/** The swatch colour for a surface, honouring which theme it is being shown in. */
export function surfaceColor(surface: BoardSurface, theme: ThemeMode): string {
  return SURFACE_RAMPS[surface][theme].base
}

/** The complete set of custom properties a preference combination implies. */
export function preferenceVariables(preferences: Preferences): Record<string, string> {
  const theme = THEME_PALETTES[preferences.theme]
  const surface = SURFACE_RAMPS[preferences.surface][preferences.theme]

  return {
    '--color-cork-900': surface.cork900,
    '--color-cork-700': surface.cork700,
    '--color-cork-500': surface.cork500,
    '--color-cork-300': surface.cork300,
    '--color-parchment-100': theme.parchment100,
    '--color-parchment-200': theme.parchment200,
    '--color-parchment-300': theme.parchment300,
    '--color-parchment-edge': theme.parchmentEdge,
    '--color-ink': theme.ink,
    '--color-ink-soft': theme.inkSoft,
    '--color-wax': theme.wax,
    '--color-brass': theme.brass,
    '--board-surface': surface.base,
    '--grid-dot-color': gridDotFor(preferences.surface, preferences.theme),
    '--color-board-ink': theme.boardInk,
    '--color-board-ink-soft': theme.boardInkSoft,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Turn anything at all into a usable Preferences. Unknown enum values, wrong
 * types, missing keys, null, arrays and unparseable text all fall back rather
 * than throw: this runs on data written by older versions of the app and by
 * whatever the browser happened to store.
 */
export function parsePreferences(raw: unknown): Preferences {
  // Storage hands back text; callers that already parsed it hand back an
  // object. Accepting both keeps load and merge on one code path.
  const value = typeof raw === 'string' ? tryParse(raw) : raw
  if (!isRecord(value)) return { ...DEFAULT_PREFERENCES }

  return {
    theme: pick(value.theme, THEMES, DEFAULT_PREFERENCES.theme),
    surface: pick(value.surface, SURFACES, DEFAULT_PREFERENCES.surface),
    yarnStyle: pick(value.yarnStyle, YARN_STYLES, DEFAULT_PREFERENCES.yarnStyle),
  }
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function samePreferences(a: Preferences, b: Preferences): boolean {
  return a.theme === b.theme && a.surface === b.surface && a.yarnStyle === b.yarnStyle
}

/**
 * Write a preference combination onto <html>.
 *
 * Variables rather than classes so a preference lands everywhere at once,
 * including inside canvas painting, and so future layers can consume tokens
 * that did not exist when they were written. The data-* attributes are the
 * escape hatch for rules that need a whole mode (`[data-yarn-style='realistic']`)
 * and for the yarn renderer, which may prefer a selector over a computed style.
 */
export function applyPreferences(preferences: Preferences): void {
  // Node tests and any non-browser render path have no document; the values
  // then simply have nowhere to land.
  if (typeof document === 'undefined') return

  const root = document.documentElement
  for (const [property, value] of Object.entries(preferenceVariables(preferences))) {
    root.style.setProperty(property, value)
  }

  root.dataset.theme = preferences.theme
  root.dataset.surface = preferences.surface
  root.dataset.yarnStyle = preferences.yarnStyle
  // Scrollbars, form controls and the page's own backdrop follow this, and the
  // browser reads it from the property rather than from any custom property.
  root.style.colorScheme = preferences.theme

  // index.css paints <body> text with the paper ramp, which is the right colour
  // on a dark board and invisible on a pale one. The ramp is overloaded (it is
  // also every paper's background), so the variable cannot be flipped without
  // making the papers dark; body is repainted directly instead.
  if (document.body) document.body.style.color = THEME_PALETTES[preferences.theme].boardInk
}

export const PREFERENCE_STORAGE_KEY = 'detective-board.preferences'

export function loadPreferences(): Preferences {
  return parsePreferences(readStored())
}

export function savePreferences(preferences: Preferences): void {
  // Storage is best-effort by design. Private windows and blocked-cookie
  // settings make even *touching* localStorage throw a SecurityError, and a
  // full quota can fail the write; a theme choice is not worth a crashed board,
  // so every failure reads as "nothing was saved".
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Swallowed on purpose — see above.
  }
}

function readStored(): unknown {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(PREFERENCE_STORAGE_KEY)
  } catch {
    return null
  }
}

let currentPreferences: Preferences = loadPreferences()
const listeners = new Set<() => void>()

// Applied at import rather than from an effect: the first paint should already
// carry the stored room, and an effect would show one frame of the default
// theme before swapping.
if (typeof document !== 'undefined') applyPreferences(currentPreferences)

export function getPreferences(): Preferences {
  return currentPreferences
}

export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Merge a patch, then persist, apply and notify.
 *
 * The merged result is re-parsed rather than trusted: a caller arriving with
 * untyped data (a URL, a broadcast message) cannot put a bogus surface into
 * state, let alone onto <html>.
 */
export function setPreferences(patch: Partial<Preferences>): Preferences {
  const merged: Record<string, unknown> = { ...currentPreferences }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value
  }

  const next = parsePreferences(merged)
  if (samePreferences(next, currentPreferences)) return currentPreferences

  currentPreferences = next
  applyPreferences(next)
  savePreferences(next)
  for (const listener of listeners) listener()
  return currentPreferences
}

/** Back to the room the board shipped with. Cheaper than clearing anything. */
export function resetPreferences(): Preferences {
  return setPreferences(DEFAULT_PREFERENCES)
}

/** One store, so every component that reads a preference sees the same value. */
export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribePreferences, getPreferences, getPreferences)
}
