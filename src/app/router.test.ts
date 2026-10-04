import { describe, expect, it } from 'vitest'

import { normalizePath, parseRoute, routeToPath } from './router'

describe('normalizePath', () => {
  it('collapses a trailing slash', () => {
    expect(normalizePath('/wiki/')).toBe('/wiki')
  })

  it('keeps the root as a single slash', () => {
    // The trailing-slash rule must not turn "/" into "".
    expect(normalizePath('/')).toBe('/')
  })

  it('collapses repeated trailing slashes', () => {
    expect(normalizePath('/wiki///')).toBe('/wiki')
  })

  it('adds a missing leading slash', () => {
    expect(normalizePath('wiki')).toBe('/wiki')
  })

  it('treats an empty path as the root', () => {
    expect(normalizePath('')).toBe('/')
  })

  it('leaves an ordinary path alone', () => {
    expect(normalizePath('/wiki/molgar')).toBe('/wiki/molgar')
  })
})

describe('parseRoute', () => {
  it('maps the root to the board', () => {
    expect(parseRoute('/')).toEqual({ name: 'board' })
  })

  it('maps /wiki to the wiki with no slug', () => {
    expect(parseRoute('/wiki')).toEqual({ name: 'wiki', slug: null })
  })

  it('treats a trailing slash as the same page', () => {
    // /wiki and /wiki/ are the same address, and a deep link may arrive either way.
    expect(parseRoute('/wiki/')).toEqual({ name: 'wiki', slug: null })
  })

  it('extracts a slug from /wiki/<slug>', () => {
    expect(parseRoute('/wiki/molgar-the-pale')).toEqual({
      name: 'wiki',
      slug: 'molgar-the-pale',
    })
  })

  it('decodes an encoded slug', () => {
    expect(parseRoute('/wiki/Molgar%20the%20Pale')).toEqual({
      name: 'wiki',
      slug: 'Molgar the Pale',
    })
  })

  it('falls back to no slug for /wiki/', () => {
    expect(parseRoute('/wiki/')).toEqual({ name: 'wiki', slug: null })
  })

  it('reports an unknown path rather than silently showing the board', () => {
    // Quietly rendering the board at a typo'd URL hides broken links.
    expect(parseRoute('/nonsense')).toEqual({ name: 'notFound', path: '/nonsense' })
  })

  it('does not treat a wiki-ish prefix as the wiki', () => {
    expect(parseRoute('/wikis')).toEqual({ name: 'notFound', path: '/wikis' })
  })
})

describe('routeToPath', () => {
  it('round-trips every route', () => {
    for (const path of ['/', '/wiki', '/wiki/molgar-the-pale']) {
      expect(routeToPath(parseRoute(path))).toBe(path)
    }
  })

  it('encodes a slug containing spaces', () => {
    expect(routeToPath({ name: 'wiki', slug: 'Molgar the Pale' })).toBe(
      '/wiki/Molgar%20the%20Pale',
    )
  })

  it('round-trips a slug through encoding and parsing', () => {
    const route = { name: 'wiki', slug: 'The Black Coin' } as const
    expect(parseRoute(routeToPath(route))).toEqual(route)
  })
})
