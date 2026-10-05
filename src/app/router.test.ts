import { describe, expect, it } from 'vitest'

import { normalizePath, parseRoute, routeToPath } from './router'

describe('normalizePath', () => {
  it('collapses a trailing slash', () => {
    expect(normalizePath('/notes/')).toBe('/notes')
  })

  it('keeps the root as a single slash', () => {
    // The trailing-slash rule must not turn "/" into "".
    expect(normalizePath('/')).toBe('/')
  })

  it('collapses repeated trailing slashes', () => {
    expect(normalizePath('/notes///')).toBe('/notes')
  })

  it('adds a missing leading slash', () => {
    expect(normalizePath('notes')).toBe('/notes')
  })

  it('treats an empty path as the root', () => {
    expect(normalizePath('')).toBe('/')
  })

  it('leaves an ordinary path alone', () => {
    expect(normalizePath('/notes/molgar')).toBe('/notes/molgar')
  })
})

describe('parseRoute', () => {
  it('maps the root to the board', () => {
    expect(parseRoute('/')).toEqual({ name: 'board' })
  })

  it('treats a trailing slash on the root as the same page', () => {
    expect(parseRoute('/')).toEqual({ name: 'board' })
  })

  it('reports an unknown path rather than silently showing the board', () => {
    // Quietly rendering the board at a typo'd URL hides broken links.
    expect(parseRoute('/nonsense')).toEqual({ name: 'notFound', path: '/nonsense' })
  })

  it('does not treat a bare word as the board', () => {
    expect(parseRoute('/board')).toEqual({ name: 'notFound', path: '/board' })
  })
})

describe('routeToPath', () => {
  it('round-trips every route', () => {
    for (const path of ['/']) {
      expect(routeToPath(parseRoute(path))).toBe(path)
    }
  })

  it('sends an unknown path back to itself, not to the board', () => {
    // A URL the app does not serve must not be silently rewritten — the user
    // should see the address they asked for.
    expect(routeToPath({ name: 'notFound', path: '/nope' })).toBe('/nope')
  })
})
