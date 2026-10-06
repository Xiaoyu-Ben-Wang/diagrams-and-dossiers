import { describe, expect, it } from 'vitest'

import { BLOCK_SEPARATOR, buildFlatText } from '../markdown/projection'
import { createAnchor, snapToWord } from './create'
import { resolveAnchor } from './resolve'
import type { Resolution } from './types'

const WORD = 'ferryman'
const WORD_LENGTH = WORD.length

type ResolvedRange = Extract<Resolution, { start: number }>

function resolved(result: Resolution): ResolvedRange {
  if (result.status === 'orphaned') {
    throw new Error(`expected a resolved range but the pin was orphaned: ${result.reason}`)
  }
  return result
}

function anchorOnWord(text: string) {
  const index = text.indexOf(WORD)
  expect(index, `fixture does not contain "${WORD}"`).toBeGreaterThanOrEqual(0)
  return createAnchor(text, index, index + WORD_LENGTH)
}

describe('snapToWord', () => {
  const text = 'The ferryman nodded.'

  it('expands a caret inside a word to the whole word', () => {
    expect(snapToWord(text, 6)).toEqual({ start: 4, end: 12 })
  })

  it('expands a caret at a word boundary to the preceding word', () => {
    expect(snapToWord(text, 12)).toEqual({ start: 4, end: 12 })
  })

  it('leaves a caret in empty space collapsed', () => {
    const result = snapToWord('   ', 1)
    expect(result.start).toBe(result.end)
  })

  it('handles a caret at the very start', () => {
    expect(snapToWord(text, 0)).toEqual({ start: 0, end: 3 })
  })

  it('steps over trailing punctuation to find the last word', () => {
    expect(snapToWord(text, text.length)).toEqual({ start: 13, end: 19 })
  })

  it('takes the word before a long whitespace run', () => {
    expect(snapToWord('alpha        beta', 7)).toEqual({ start: 0, end: 5 })
    expect(snapToWord('alpha        beta', 12)).toEqual({ start: 0, end: 5 })
  })
})

describe('createAnchor', () => {
  const text = 'The ferryman nodded slowly at the stranger.'

  it('snaps a collapsed caret to the surrounding word', () => {
    const anchor = createAnchor(text, 6, 6)
    expect(anchor.quote).toBe(WORD)
    expect(text.slice(anchor.startOffset, anchor.endOffset)).toBe(WORD)
  })

  it('captures surrounding context for disambiguation', () => {
    const anchor = createAnchor(text, 4, 4 + WORD_LENGTH)
    expect(anchor.quote).toBe(WORD)
    expect(anchor.prefix).toBe('The ')
    expect(anchor.suffix).toBe(' nodded slowly at the stranger.')
  })

  it('truncates context at the start of the article', () => {
    const anchor = createAnchor(text, 0, 3)
    expect(anchor.prefix).toBe('')
  })

  it('normalizes a reversed range rather than producing a negative slice', () => {
    const anchor = createAnchor(text, 4 + WORD_LENGTH, 4)
    expect(anchor.quote).toBe(WORD)
  })

  it('snaps a caret in a whitespace gap to the preceding word', () => {
    const anchor = createAnchor('a    b', 2, 2)
    expect(anchor.quote).toBe('a')
  })

  it('leaves an empty quote when no word precedes the caret', () => {
    const anchor = createAnchor('   hello', 1, 1)
    expect(anchor.quote).toBe('')
  })
})

describe('resolveAnchor', () => {
  it('resolves exactly when nothing has moved', () => {
    const flat = buildFlatText(['The ferryman nodded.'])
    const anchor = anchorOnWord(flat.text)

    const result = resolved(resolveAnchor(flat.text, anchor))
    expect(result.status).toBe('exact')
    expect(flat.text.slice(result.start, result.end)).toBe(WORD)
  })

  it('reports an orphan when the quoted text is gone', () => {
    const flat = buildFlatText(['The ferryman nodded.'])
    const anchor = anchorOnWord(flat.text)

    const rewritten = buildFlatText(['The dockhand nodded.'])
    const result = resolveAnchor(rewritten.text, anchor)

    expect(result.status).toBe('orphaned')
    if (result.status === 'orphaned') expect(result.reason).toBe('quote-not-found')
  })

  it('reports an orphan for an empty quote rather than matching everywhere', () => {
    const flat = buildFlatText(['anything at all'])
    const result = resolveAnchor(flat.text, {
      quote: '',
      prefix: '',
      suffix: '',
      startOffset: 0,
      endOffset: 0,
    })
    expect(result.status).toBe('orphaned')
  })

  it('uses surrounding context to choose between repeated phrases', () => {
    const original = 'The ferryman nodded. Later, the ferryman refused.'
    const before = buildFlatText([original])
    const anchor = anchorOnWord(before.text)
    expect(anchor.startOffset).toBe(4)

    const after = buildFlatText(['At dawn. ' + original])
    const result = resolved(resolveAnchor(after.text, anchor))

    expect(result.status).toBe('repaired')
    expect(after.text.slice(result.start, result.end)).toBe(WORD)
    expect(after.text.slice(result.start - 4, result.start)).toBe('The ')
    expect(after.text.slice(result.end, result.end + 8)).toBe(' nodded.')
  })

  it('falls back to a global search when an edit moves the pin a long way', () => {
    const original = 'The ferryman nodded.'
    const before = buildFlatText([original])
    const anchor = anchorOnWord(before.text)

    const padding = 'A very long preamble. '.repeat(200)
    expect(padding.length).toBeGreaterThan(2000)

    const after = buildFlatText([padding + original])
    const result = resolved(resolveAnchor(after.text, anchor))

    expect(result.status).toBe('repaired')
    if (result.status === 'repaired') expect(result.reason).toBe('global-search')
    expect(after.text.slice(result.start, result.end)).toBe(WORD)
  })

  it('reports low confidence when the context has changed around a unique quote', () => {
    const before = buildFlatText(['The ferryman nodded slowly at the stranger.'])
    const anchor = anchorOnWord(before.text)

    const after = buildFlatText(['Completely rewritten prose about a ferryman, alas.'])
    const result = resolved(resolveAnchor(after.text, anchor))

    expect(result.status).toBe('repaired')
    if (result.status === 'repaired') {
      expect(result.reason).toBe('fuzzy-context')
      expect(result.confidence).toBeLessThan(1)
    }
  })
})

describe('the thesis: a pin survives edits to the article', () => {
  const article = (...nodes: string[]) => buildFlatText(nodes)

  const heading = `Session Twelve${BLOCK_SEPARATOR}`

  it('still lands on the right words after a sentence is inserted above it', () => {
    const before = article(
      heading,
      `The tavern was quiet. ${BLOCK_SEPARATOR}`,
      'Molgar paid the ferryman in silver.',
    )
    const anchor = anchorOnWord(before.text)

    const after = article(
      heading,
      `It rained without stopping that night. ${BLOCK_SEPARATOR}`,
      `The tavern was quiet. ${BLOCK_SEPARATOR}`,
      'Molgar paid the ferryman in silver.',
    )

    const result = resolved(resolveAnchor(after.text, anchor))
    expect(after.text.slice(result.start, result.end)).toBe(WORD)
  })

  it('still lands on the right words after the phrase is wrapped in bold', () => {
    const before = article('Molgar paid the ', WORD, ' in silver.')
    const anchor = anchorOnWord(before.text)

    const after = article('Molgar paid the ', 'ferry', 'man', ' in silver.')

    const result = resolved(resolveAnchor(after.text, anchor))
    expect(result.status).toBe('exact')
    expect(after.text.slice(result.start, result.end)).toBe(WORD)
  })

  it('still lands correctly when a paragraph above is split in two', () => {
    const before = article('The tavern was quiet and cold. ', 'Molgar paid the ferryman.')
    const anchor = anchorOnWord(before.text)

    const after = article(
      'The tavern was quiet. ',
      BLOCK_SEPARATOR,
      'It was cold. ',
      'Molgar paid the ferryman.',
    )

    const result = resolved(resolveAnchor(after.text, anchor))
    expect(after.text.slice(result.start, result.end)).toBe(WORD)
  })

  it('survives edits that change whitespace but not the words', () => {
    const before = article('Molgar paid the ferryman in silver.')
    const anchor = anchorOnWord(before.text)

    const after = article('Molgar paid\tthe\n\nferryman   in silver.')

    const result = resolved(resolveAnchor(after.text, anchor))
    expect(result.status).toBe('exact')
    expect(after.text.slice(result.start, result.end)).toBe(WORD)
  })

  it('admits it is lost rather than landing on the wrong sentence', () => {
    const before = article('Molgar paid the ferryman in silver.')
    const anchor = anchorOnWord(before.text)

    const after = article('Molgar settled his debts at the docks.')

    expect(resolveAnchor(after.text, anchor).status).toBe('orphaned')
  })
})
