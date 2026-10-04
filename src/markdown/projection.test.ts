import { describe, expect, it } from 'vitest'

import { buildFlatText, flatToRaw, normalize, rawToFlat } from './projection'

describe('normalize', () => {
  it('collapses runs of whitespace to a single space', () => {
    expect(normalize('hello    world').text).toBe('hello world')
    expect(normalize('hello\n\n\tworld').text).toBe('hello world')
    expect(normalize('hello \n world').text).toBe('hello world')
  })

  it('preserves a leading run as a single space', () => {
    // Load-bearing: in "The <strong>tavern</strong> was quiet." the space
    // before "was" is the LEADING character of the following text node.
    // Dropping it would render "tavernwas".
    expect(normalize('   hello').text).toBe(' hello')
  })

  it('preserves a trailing run as a single space', () => {
    // The other half of the same problem: the space after "The" is the
    // TRAILING character of the preceding text node.
    expect(normalize('hello   ').text).toBe('hello ')
  })

  it('preserves whitespace exactly when asked, for code blocks', () => {
    const raw = '  if (x) {\n    return 1\n  }'
    const result = normalize(raw, { preserveWhitespace: true })
    expect(result.text).toBe(raw)
  })

  it('maps every normalized index back to a raw index', () => {
    const raw = 'a   b'
    const result = normalize(raw)
    expect(result.text).toBe('a b')
    // The collapsed space maps to where the whitespace run started.
    expect(result.map.map((rawIndex) => raw[rawIndex])).toEqual(['a', ' ', 'b'])
  })

  it('keeps the map monotonic so binary/linear search is valid', () => {
    const result = normalize('one  two   three\n\nfour')
    for (let i = 1; i < result.map.length; i++) {
      expect(result.map[i]).toBeGreaterThanOrEqual(result.map[i - 1])
    }
  })
})

describe('buildFlatText', () => {
  it('joins nodes without introducing a double space at the seam', () => {
    // "hello " + " world" would naively concatenate to "hello  world".
    const flat = buildFlatText(['hello ', ' world'])
    expect(flat.text).toBe('hello world')
  })

  it('preserves word separation across an inline element boundary', () => {
    // The common real case: text, then <strong>bold</strong>, then more text.
    const flat = buildFlatText(['The ', 'tavern', ' was quiet.'])
    expect(flat.text).toBe('The tavern was quiet.')
  })

  it('records where each node begins', () => {
    const flat = buildFlatText(['ab', 'cd', 'ef'])
    expect(flat.starts).toEqual([0, 2, 4])
    expect(flat.text).toBe('abcdef')
  })

  it('produces identical offsets whether or not inline markup is present', () => {
    // This is the entire reason offsets index text content rather than HTML:
    // wrapping a phrase in bold must not move a single anchor.
    const plain = buildFlatText(['Molgar paid the ferryman in silver.'])
    const bold = buildFlatText(['Molgar paid the ', 'ferryman', ' in silver.'])

    expect(bold.text).toBe(plain.text)

    const plainIndex = plain.text.indexOf('ferryman')
    const boldIndex = bold.text.indexOf('ferryman')
    expect(boldIndex).toBe(plainIndex)
  })
})

describe('offset conversion', () => {
  const flat = buildFlatText(['The tavern  ', 'was   quiet.'])

  it('round-trips a flat offset out to raw and back', () => {
    const raw = flatToRaw(flat, 4)
    expect(raw).not.toBeNull()
    const back = rawToFlat(flat, raw!.nodeIndex, raw!.rawOffset)
    expect(back).toBe(4)
  })

  it('resolves an offset past a collapsed run to the correct node', () => {
    // "The tavern was| quiet." — flat offset 13 is inside the second node, and
    // the raw offset must account for that node's collapsed whitespace run
    // ("was   quiet." is 12 raw characters but 10 normalized ones).
    const raw = flatToRaw(flat, 13)
    expect(raw?.nodeIndex).toBe(1)
    expect(flat.nodes[1].raw[raw!.rawOffset]).toBe('s')
  })

  it('returns null for an offset beyond the end of the text', () => {
    expect(flatToRaw(flat, flat.text.length + 50)).toBeNull()
  })

  it('round-trips every offset in the document', () => {
    // Exhaustive: any drift here would put pins one character off, which is
    // the kind of bug that looks like "the pin is slightly wrong sometimes".
    for (let i = 0; i <= flat.text.length; i++) {
      const raw = flatToRaw(flat, i)
      expect(raw, `offset ${i} failed to resolve`).not.toBeNull()
      expect(rawToFlat(flat, raw!.nodeIndex, raw!.rawOffset)).toBe(i)
    }
  })
})
