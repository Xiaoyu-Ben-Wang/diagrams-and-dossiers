import { describe, expect, it } from 'vitest'

import {
  buildBacklinks,
  parseWikiLinks,
  resolveTarget,
  slugify,
  unresolvedLinks,
  type ArticleLike,
} from './links'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Molgar the Pale')).toBe('molgar-the-pale')
  })

  it('strips apostrophes rather than hyphenating them', () => {
    expect(slugify("Harbormaster's Ledger")).toBe('harbormasters-ledger')
    expect(slugify('Harbormaster’s Ledger')).toBe('harbormasters-ledger')
  })

  it('collapses runs of punctuation', () => {
    expect(slugify('The  Black   Coin!!')).toBe('the-black-coin')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  —Saltmarsh—  ')).toBe('saltmarsh')
  })

  it('keeps digits', () => {
    expect(slugify('Session 12')).toBe('session-12')
  })

  it('is stable — same input, same slug', () => {
    expect(slugify('The Drowned Bell')).toBe(slugify('The Drowned Bell'))
  })
})

describe('parseWikiLinks', () => {
  it('finds a plain link', () => {
    const links = parseWikiLinks('See [[Molgar the Pale]] for details.')
    expect(links).toHaveLength(1)
    expect(links[0].target).toBe('Molgar the Pale')
    expect(links[0].label).toBe('Molgar the Pale')
    expect(links[0].section).toBeNull()
  })

  it('honours an alias', () => {
    const links = parseWikiLinks('See [[Molgar the Pale|the pale one]].')
    expect(links[0].target).toBe('Molgar the Pale')
    expect(links[0].label).toBe('the pale one')
  })

  it('allows a pipe inside the alias', () => {
    const links = parseWikiLinks('[[Target|a|b]]')
    expect(links[0].target).toBe('Target')
    expect(links[0].label).toBe('a|b')
  })

  it('extracts a section', () => {
    const links = parseWikiLinks('[[The Drowned Bell#What we know]]')
    expect(links[0].target).toBe('The Drowned Bell')
    expect(links[0].section).toBe('What we know')
  })

  it('finds several links in order', () => {
    const links = parseWikiLinks('[[A]] then [[B]] then [[C]]')
    expect(links.map((l) => l.target)).toEqual(['A', 'B', 'C'])
    expect(links[0].index).toBeLessThan(links[1].index)
    expect(links[1].index).toBeLessThan(links[2].index)
  })

  it('reports the offset of the whole construct', () => {
    const text = 'See [[Molgar]] now'
    const [link] = parseWikiLinks(text)
    expect(text.slice(link.index, link.index + link.length)).toBe('[[Molgar]]')
  })

  it('ignores a link inside a fenced code block', () => {
    // A session log documenting the note syntax would otherwise sprout a
    // phantom page called "Molgar".
    const text = ['```', '[[Molgar the Pale]]', '```', '[[Real]]'].join('\n')
    const links = parseWikiLinks(text)
    expect(links.map((l) => l.target)).toEqual(['Real'])
  })

  it('ignores a link inside a tilde fence', () => {
    const text = ['~~~', '[[Nope]]', '~~~'].join('\n')
    expect(parseWikiLinks(text)).toEqual([])
  })

  it('ignores a link inside an inline code span', () => {
    const links = parseWikiLinks('Use `[[Target]]` to link, like [[Real]].')
    expect(links.map((l) => l.target)).toEqual(['Real'])
  })

  it('handles a double-backtick span containing a backtick', () => {
    const links = parseWikiLinks('``a ` [[Nope]]`` and [[Real]]')
    expect(links.map((l) => l.target)).toEqual(['Real'])
  })

  it('resumes scanning after a code span closes', () => {
    const links = parseWikiLinks('`[[no]]` [[yes]] `[[no]]` [[yes2]]')
    expect(links.map((l) => l.target)).toEqual(['yes', 'yes2'])
  })

  it('ignores empty brackets', () => {
    expect(parseWikiLinks('[[]]')).toEqual([])
    expect(parseWikiLinks('[[   ]]')).toEqual([])
    expect(parseWikiLinks('[[|label]]')).toEqual([])
  })

  it('ignores an unclosed link', () => {
    expect(parseWikiLinks('[[Molgar')).toEqual([])
  })

  it('does not match single brackets', () => {
    expect(parseWikiLinks('[Molgar](http://example.com)')).toEqual([])
  })

  it('handles links on consecutive lines', () => {
    const links = parseWikiLinks('[[A]]\n[[B]]')
    expect(links.map((l) => l.target)).toEqual(['A', 'B'])
    // Offsets are into the whole document, not the line.
    expect(links[1].index).toBe(6)
  })

  it('returns nothing for plain prose', () => {
    expect(parseWikiLinks('Just some words about a ferryman.')).toEqual([])
  })
})

describe('resolveTarget', () => {
  const articles = [
    { slug: 'molgar-the-pale', title: 'Molgar the Pale' },
    { slug: 'the-black-coin', title: 'The Black Coin' },
  ]

  it('matches an exact slug', () => {
    const [link] = parseWikiLinks('[[molgar-the-pale]]')
    expect(resolveTarget(link, articles)).toBe('molgar-the-pale')
  })

  it('matches an exact title', () => {
    const [link] = parseWikiLinks('[[Molgar the Pale]]')
    expect(resolveTarget(link, articles)).toBe('molgar-the-pale')
  })

  it('ignores case, because nobody types it the same way twice', () => {
    const [link] = parseWikiLinks('[[MOLGAR THE PALE]]')
    expect(resolveTarget(link, articles)).toBe('molgar-the-pale')
  })

  it('matches a slugified title', () => {
    const [link] = parseWikiLinks("[[Molgar  the  Pale!]]")
    expect(resolveTarget(link, articles)).toBe('molgar-the-pale')
  })

  it('resolves through an alias by target, not label', () => {
    const [link] = parseWikiLinks('[[Molgar the Pale|the pale one]]')
    expect(resolveTarget(link, articles)).toBe('molgar-the-pale')
  })

  it('returns null for a target that does not exist', () => {
    const [link] = parseWikiLinks('[[Nobody At All]]')
    expect(resolveTarget(link, articles)).toBeNull()
  })
})

describe('buildBacklinks', () => {
  const articles: ArticleLike[] = [
    {
      slug: 'the-drowned-bell',
      title: 'The Drowned Bell',
      body: 'Molgar paid the ferryman. See [[The Black Coin]] and [[Molgar the Pale]].',
    },
    {
      slug: 'session-twelve',
      title: 'Session Twelve',
      body: 'We found [[The Black Coin]] again. Also [[The Black Coin]].',
    },
    {
      slug: 'the-black-coin',
      title: 'The Black Coin',
      body: 'A coin. Mentioned by [[Molgar the Pale]].',
    },
    {
      slug: 'molgar-the-pale',
      title: 'Molgar the Pale',
      body: 'A ferryman of few words.',
    },
  ]

  it('records who links to an article', () => {
    const backlinks = buildBacklinks(articles)
    const targets = backlinks.get('the-black-coin') ?? []
    expect(targets.map((b) => b.fromSlug).sort()).toEqual(['session-twelve', 'the-drowned-bell'])
  })

  it('counts repeats rather than listing the same source twice', () => {
    const backlinks = buildBacklinks(articles)
    const session = (backlinks.get('the-black-coin') ?? []).find(
      (b) => b.fromSlug === 'session-twelve',
    )
    expect(session?.count).toBe(2)
  })

  it('gathers links from several sources to one target', () => {
    const backlinks = buildBacklinks(articles)
    expect(backlinks.get('molgar-the-pale')?.map((b) => b.fromSlug).sort()).toEqual([
      'the-black-coin',
      'the-drowned-bell',
    ])
  })

  it('gives an article with no backlinks an empty list, not an entry', () => {
    const backlinks = buildBacklinks(articles)
    expect(backlinks.get('the-drowned-bell')).toBeUndefined()
  })

  it('ignores links to articles that do not exist', () => {
    const withTypo: ArticleLike[] = [
      { slug: 'a', title: 'A', body: 'See [[Typo Target]] and [[A]].' },
      { slug: 'b', title: 'B', body: 'Nothing.' },
    ]
    const backlinks = buildBacklinks(withTypo)
    expect(backlinks.get('b')).toBeUndefined()
    expect([...backlinks.keys()]).toEqual([])
  })

  it('ignores self-links', () => {
    const selfLink: ArticleLike[] = [{ slug: 'a', title: 'A', body: 'See [[A]].' }]
    expect(buildBacklinks(selfLink).size).toBe(0)
  })

  it('orders each list by title so the panel does not reshuffle', () => {
    const many: ArticleLike[] = [
      { slug: 'target', title: 'Target', body: 'x' },
      { slug: 'z', title: 'Zebra', body: '[[Target]]' },
      { slug: 'a', title: 'Apple', body: '[[Target]]' },
      { slug: 'm', title: 'Mango', body: '[[Target]]' },
    ]
    const list = buildBacklinks(many).get('target') ?? []
    expect(list.map((b) => b.fromTitle)).toEqual(['Apple', 'Mango', 'Zebra'])
  })

  it('does not link from inside code blocks', () => {
    const coded: ArticleLike[] = [
      { slug: 'target', title: 'Target', body: 'x' },
      { slug: 'doc', title: 'Doc', body: '```\n[[Target]]\n```' },
    ]
    expect(buildBacklinks(coded).get('target')).toBeUndefined()
  })

  it('handles an empty corpus', () => {
    expect(buildBacklinks([]).size).toBe(0)
  })
})

describe('unresolvedLinks', () => {
  it('reports links with no matching article', () => {
    const articles: ArticleLike[] = [
      { slug: 'a', title: 'A', body: 'See [[Nobody]] and [[Also Missing]].' },
    ]
    expect(unresolvedLinks(articles).map((u) => u.target)).toEqual(['Nobody', 'Also Missing'])
  })

  it('says which article contains the dangling link', () => {
    const articles: ArticleLike[] = [{ slug: 'a', title: 'Session Twelve', body: '[[Nobody]]' }]
    expect(unresolvedLinks(articles)[0].fromTitle).toBe('Session Twelve')
  })

  it('does not repeat the same target from the same article', () => {
    const articles: ArticleLike[] = [{ slug: 'a', title: 'A', body: '[[Nobody]] [[Nobody]]' }]
    expect(unresolvedLinks(articles)).toHaveLength(1)
  })

  it('reports nothing when everything resolves', () => {
    const articles: ArticleLike[] = [
      { slug: 'a', title: 'A', body: '[[B]]' },
      { slug: 'b', title: 'B', body: 'back to [[A]]' },
    ]
    expect(unresolvedLinks(articles)).toEqual([])
  })
})
