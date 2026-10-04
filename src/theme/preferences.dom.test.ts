// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  SURFACES,
  getPreferences,
  preferenceVariables,
  resetPreferences,
  setPreferences,
  surfaceColor,
  type BoardSurface,
} from './preferences'

afterEach(() => {
  resetPreferences()
})

/** The @theme block in index.css, the source of truth the dark default mirrors. */
function indexCssTokens(): Record<string, string> {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
  const start = css.indexOf('@theme')
  const block = css.slice(start, css.indexOf('}', start))
  const tokens: Record<string, string> = {}
  for (const match of block.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) {
    tokens[`--color-${match[1]}`] = (match[2] as string).toLowerCase()
  }
  return tokens
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16)
  return (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255
}

describe('applyPreferences in a document', () => {
  it('writes every preference token as a custom property on the root', () => {
    setPreferences({ theme: 'light', surface: 'felt', yarnStyle: 'realistic' })

    const root = document.documentElement
    const expected = preferenceVariables(getPreferences())
    for (const [property, value] of Object.entries(expected)) {
      expect(root.style.getPropertyValue(property), property).toBe(value)
    }

    expect(root.dataset.theme).toBe('light')
    expect(root.dataset.surface).toBe('felt')
    expect(root.dataset.yarnStyle).toBe('realistic')
  })

  it('repaints when a surface changes', () => {
    setPreferences({ surface: 'felt' })
    const felt = document.documentElement.style.getPropertyValue('--color-cork-500')

    setPreferences({ surface: 'slate' })
    expect(document.documentElement.style.getPropertyValue('--color-cork-500')).not.toBe(felt)
  })

  it('defaults dark cork to exactly what index.css declares', () => {
    const tokens = indexCssTokens()
    const applied = preferenceVariables(DEFAULT_PREFERENCES)

    // A first visit never opens the drawer, so dark+cork must be the tokens the
    // board already had — any mismatch here is a visible flash of drift.
    for (const [property, value] of Object.entries(applied)) {
      const declared = tokens[property]
      if (declared === undefined) continue // board-ink* are new, consumed only via var() fallbacks
      expect(value.toLowerCase(), property).toBe(declared)
    }
    // The new tokens reproduce what chrome already painted on a dark board:
    // the paper ramp used as text.
    expect(applied['--color-board-ink']).toBe(tokens['--color-parchment-100'])
    expect(applied['--color-board-ink-soft']).toBe(tokens['--color-parchment-300'])
  })

  it('makes light mode a pale board with dark ink rather than dark mode brightened', () => {
    setPreferences({ theme: 'light' })
    const light = preferenceVariables(getPreferences())
    const dark = preferenceVariables(DEFAULT_PREFERENCES)

    expect(light['--color-parchment-100']).not.toBe(dark['--color-parchment-100'])
    expect(luminance(light['--board-surface'] as string)).toBeGreaterThan(0.6)
    expect(luminance(light['--color-board-ink'] as string)).toBeLessThan(0.3)
  })

  it('gives every surface a pale light variant distinct from its dark one', () => {
    for (const surface of SURFACES) {
      expect(surfaceColor(surface as BoardSurface, 'light'), surface).not.toBe(
        surfaceColor(surface as BoardSurface, 'dark'),
      )
      expect(luminance(surfaceColor(surface as BoardSurface, 'light')), surface).toBeGreaterThan(0.6)
    }
  })
})
