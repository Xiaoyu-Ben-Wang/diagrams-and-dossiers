import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  PREFERENCE_STORAGE_KEY,
  applyPreferences,
  getPreferences,
  loadPreferences,
  parsePreferences,
  resetPreferences,
  savePreferences,
  setPreferences,
  subscribePreferences,
  type Preferences,
} from './preferences'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length(): number {
      return map.size
    },
    clear: () => {
      map.clear()
    },
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
}

/** Storage as a locked-down browser hands it over: every touch throws. */
function hostileStorage(): Storage {
  const deny = (): never => {
    throw new Error('storage is blocked')
  }
  return {
    get length(): number {
      return deny()
    },
    clear: deny,
    getItem: deny,
    key: deny,
    removeItem: deny,
    setItem: deny,
  }
}

function installStorage(storage: Storage | null): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage ?? undefined,
  })
}

afterEach(() => {
  resetPreferences()
  installStorage(null)
})

describe('parsePreferences', () => {
  it('returns defaults for null, undefined and non-objects', () => {
    for (const garbage of [null, undefined, 42, true, Symbol('nope')]) {
      expect(parsePreferences(garbage)).toEqual(DEFAULT_PREFERENCES)
    }
  })

  it('returns defaults for text that is not JSON', () => {
    expect(parsePreferences('{theme: dark,')).toEqual(DEFAULT_PREFERENCES)
    expect(parsePreferences('not json at all')).toEqual(DEFAULT_PREFERENCES)
  })

  it('returns defaults for an array', () => {
    expect(parsePreferences(['dark', 'cork'])).toEqual(DEFAULT_PREFERENCES)
  })

  it('replaces unknown enum values with defaults', () => {
    const parsed = parsePreferences({ theme: 'neon', surface: 'plaid', yarnStyle: 'fuzzy' })
    expect(parsed).toEqual(DEFAULT_PREFERENCES)
  })

  it('replaces wrong-typed values with defaults', () => {
    const parsed = parsePreferences({ theme: 7, surface: {}, yarnStyle: false })
    expect(parsed).toEqual(DEFAULT_PREFERENCES)
  })

  it('fills missing keys from defaults', () => {
    expect(parsePreferences({ surface: 'felt' })).toEqual({ ...DEFAULT_PREFERENCES, surface: 'felt' })
  })

  it('ignores unknown keys', () => {
    const parsed = parsePreferences({ theme: 'light', volume: 11, nested: { a: 1 } })
    expect(parsed).toEqual({ ...DEFAULT_PREFERENCES, theme: 'light' })
  })

  it('parses JSON text, the shape localStorage hands back', () => {
    const parsed = parsePreferences('{"theme":"light","surface":"slate","yarnStyle":"realistic"}')
    expect(parsed).toEqual({ theme: 'light', surface: 'slate', yarnStyle: 'realistic' })
  })

  it('reads a half-written entry without losing the valid half', () => {
    const parsed = parsePreferences('{"theme":"light","surface":13}')
    expect(parsed).toEqual({ ...DEFAULT_PREFERENCES, theme: 'light' })
  })
})

describe('preference storage', () => {
  beforeEach(() => {
    installStorage(memoryStorage())
  })

  it('round-trips a full preference set', () => {
    const wanted: Preferences = { theme: 'light', surface: 'felt', yarnStyle: 'realistic' }
    savePreferences(wanted)
    expect(loadPreferences()).toEqual(wanted)
  })

  it('reads defaults when nothing was ever saved', () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES)
  })

  it('reads defaults when the stored entry is corrupt', () => {
    localStorage.setItem(PREFERENCE_STORAGE_KEY, '{"theme":')
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES)
  })

  it('writes under a namespaced key', () => {
    savePreferences(DEFAULT_PREFERENCES)
    expect(localStorage.getItem(PREFERENCE_STORAGE_KEY)).toContain('"theme":"dark"')
  })
})

describe('preference store', () => {
  beforeEach(() => {
    installStorage(memoryStorage())
  })

  it('updates the value every subscriber reads', () => {
    let notifications = 0
    const unsubscribe = subscribePreferences(() => {
      notifications++
    })

    setPreferences({ theme: 'light', yarnStyle: 'realistic' })

    expect(notifications).toBe(1)
    expect(getPreferences()).toEqual({ ...DEFAULT_PREFERENCES, theme: 'light', yarnStyle: 'realistic' })
    unsubscribe()
  })

  it('stops notifying after unsubscribe', () => {
    let notifications = 0
    const unsubscribe = subscribePreferences(() => {
      notifications++
    })
    unsubscribe()

    setPreferences({ surface: 'slate' })

    expect(notifications).toBe(0)
  })

  it('does not notify when the patch changes nothing', () => {
    let notifications = 0
    subscribePreferences(() => {
      notifications++
    })

    setPreferences({ theme: DEFAULT_PREFERENCES.theme })

    expect(notifications).toBe(0)
  })

  it('persists what it accepted', () => {
    setPreferences({ surface: 'leather' })
    expect(loadPreferences().surface).toBe('leather')
  })

  it('rejects a patch carrying an unknown value', () => {
    const garbage = { theme: 'neon' } as unknown as Partial<Preferences>
    setPreferences(garbage)
    expect(getPreferences().theme).toBe(DEFAULT_PREFERENCES.theme)
  })

  it('ignores undefined patch entries instead of resetting them', () => {
    setPreferences({ theme: 'light', surface: 'slate' })
    setPreferences({ yarnStyle: undefined })
    expect(getPreferences()).toEqual({ theme: 'light', surface: 'slate', yarnStyle: DEFAULT_PREFERENCES.yarnStyle })
  })

  it('returns to defaults on reset and saves that', () => {
    setPreferences({ theme: 'light', surface: 'felt', yarnStyle: 'realistic' })
    resetPreferences()
    expect(getPreferences()).toEqual(DEFAULT_PREFERENCES)
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES)
  })
})

describe('applyPreferences', () => {
  it('is a no-op without a document', () => {
    // The default test environment is node; this path is what keeps a shared
    // preferences module importable from pure logic.
    expect(typeof document).toBe('undefined')
    expect(() => applyPreferences(DEFAULT_PREFERENCES)).not.toThrow()
  })
})

describe('a throwing localStorage', () => {
  beforeEach(() => {
    installStorage(hostileStorage())
  })

  it('loads defaults instead of propagating', () => {
    expect(() => loadPreferences()).not.toThrow()
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES)
  })

  it('saves without propagating', () => {
    expect(() => savePreferences({ theme: 'light', surface: 'felt', yarnStyle: 'realistic' })).not.toThrow()
  })

  it('still updates the in-memory store so the board keeps working', () => {
    expect(() => setPreferences({ theme: 'light' })).not.toThrow()
    expect(getPreferences().theme).toBe('light')
    expect(() => resetPreferences()).not.toThrow()
  })
})
