// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { newArticle, newNote } from '../model/create'
import type { BoardEntity } from '../model/types'
import {
  MENTION_ATTRIBUTE,
  MENTION_MISSING_CLASS,
  linkifyMentions,
  markMissingMentions,
  mentionHref,
  parseMentions,
  resolveMention,
} from './mentions'

const page = (title: string, id = title): BoardEntity =>
  newArticle({ x: 0, y: 0 }, '# Body', title, undefined, { id })

describe('parsing', () => {
  it('finds a mention and what it names', () => {
    expect(parseMentions('See @[The Drowned Bell] about it.')).toEqual([
      { index: 4, length: 19, name: 'The Drowned Bell' },
    ])
  })

  it('finds several, in order', () => {
    const found = parseMentions('@[One] then @[Two] then @[Three]')
    expect(found.map((mention) => mention.name)).toEqual(['One', 'Two', 'Three'])
    expect(found.map((mention) => mention.index)).toEqual([0, 12, 24])
  })

  it('trims the name but keeps the run whole', () => {
    const [mention] = parseMentions('@[  Spaced  ]')
    expect(mention.name).toBe('Spaced')
    // The run covers what was written, not what it trimmed to — the renderer
    // replaces the whole of it.
    expect(mention.length).toBe('@[  Spaced  ]'.length)
  })

  it('leaves an address alone', () => {
    // `molgar@[the pale]` is somebody's email, not a link.
    expect(parseMentions('write to molgar@[the pale] today')).toEqual([])
  })

  it('still links after punctuation, which is how people write', () => {
    expect(parseMentions('(@[One])')).toEqual([{ index: 1, length: 6, name: 'One' }])
    expect(parseMentions('"@[One]"')).toEqual([{ index: 1, length: 6, name: 'One' }])
  })

  it('ignores an unclosed or empty one', () => {
    expect(parseMentions('@[unclosed')).toEqual([])
    expect(parseMentions('@[]')).toEqual([])
    expect(parseMentions('@[   ]')).toEqual([])
  })

  it('stops at a line break rather than swallowing the next line', () => {
    expect(parseMentions('@[One\ntwo]')).toEqual([])
  })
})

describe('the href', () => {
  it('is a fragment, so a name can never become a scheme', () => {
    // The name is author-written. Without this, a name of `javascript:…` would
    // be executable by middle-click or keyboard, past a click handler that only
    // guards the ordinary click.
    expect(mentionHref('javascript:alert(1)')).toBe('#mention:javascript%3Aalert(1)')
    expect(mentionHref('javascript:alert(1)').startsWith('#')).toBe(true)
  })
})

describe('linkifying', () => {
  it('turns a mention into an anchor displaying the name', () => {
    const html = linkifyMentions('<p>See @[The Bell] there.</p>')

    expect(html).toContain('<a class="mention" href="#mention:The%20Bell" data-mention="The Bell">The Bell</a>')
    // The syntax is gone, which is why this has to happen before the article is
    // projected into flat text.
    expect(html).not.toContain('@[')
    expect(html).toContain('See ')
    expect(html).toContain(' there.')
  })

  it('produces the same markup whether or not the name resolves', () => {
    // The load-bearing property. A difference here would have React replace the
    // innerHTML — new text nodes — with no layout-signature change and no
    // resize, leaving the anchor projection pointing at detached nodes.
    const once = linkifyMentions('<p>@[Anything At All]</p>')
    const twice = linkifyMentions('<p>@[Anything At All]</p>')
    expect(once).toBe(twice)
    expect(once).not.toContain('missing')
  })

  it('leaves code alone, so an article can document the syntax', () => {
    expect(linkifyMentions('<p><code>@[Not A Link]</code></p>')).not.toContain('<a')
    expect(linkifyMentions('<pre>@[Not A Link]</pre>')).not.toContain('<a')
  })

  it('does not put an anchor inside an anchor', () => {
    // Invalid markup, and a browser will unnest it in ways the projection does
    // not expect.
    const html = linkifyMentions('<p><a href="http://x.test">@[Nested]</a></p>')
    expect(html.match(/<a /g)).toHaveLength(1)
  })

  it('never lets a name become markup', () => {
    // The angle brackets arrive escaped, which is what the sanitiser would have
    // left of them — so the name is that literal text, and it has to leave as
    // text rather than becoming a tag.
    const html = linkifyMentions('<p>@[&lt;img src=x onerror=alert(1)&gt;]</p>')

    // Asserted by parsing the result back rather than by looking for a
    // substring: the raw angle bracket does appear, harmlessly, inside the
    // attribute value the serializer quotes. What matters is that no element
    // was created from it.
    const round = document.createElement('div')
    round.innerHTML = html
    expect(round.querySelector('img')).toBeNull()
    expect(round.querySelector('a')!.textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('returns the html untouched when there is nothing to find', () => {
    const html = '<p>Just prose, no links at all.</p>'
    expect(linkifyMentions(html)).toBe(html)
  })
})

describe('resolving', () => {
  it('matches a title case-insensitively', () => {
    const entities = [page('The Drowned Bell')]
    expect(resolveMention('the drowned bell', entities)?.id).toBe('The Drowned Bell')
    expect(resolveMention('  The Drowned Bell  ', entities)?.id).toBe('The Drowned Bell')
  })

  it('will not resolve a note, even one with the same title', () => {
    // A mention names a page or a picture. A note that happens to share a title
    // must not be able to hijack the link.
    const note = { ...newNote({ x: 0, y: 0 }), title: 'The Drowned Bell' }
    expect(resolveMention('The Drowned Bell', [note])).toBeNull()
  })

  it('will not resolve an untitled thing', () => {
    const untitled = newArticle({ x: 0, y: 0 }, '# x', '')
    expect(resolveMention('', [untitled])).toBeNull()
  })

  it('takes the first of two with the same name, rather than neither', () => {
    const entities = [page('Ledger', 'one'), page('Ledger', 'two')]
    expect(resolveMention('Ledger', entities)?.id).toBe('one')
  })
})

describe('marking the ones that name nothing', () => {
  it('adds the class to a mention with no target, and only to that one', () => {
    const root = document.createElement('div')
    root.innerHTML = linkifyMentions('<p>@[Known] and @[Unknown]</p>')

    markMissingMentions(root, new Set(['known']))

    const [known, unknown] = Array.from(root.querySelectorAll(`[${MENTION_ATTRIBUTE}]`))
    expect(known.classList.contains(MENTION_MISSING_CLASS)).toBe(false)
    expect(unknown.classList.contains(MENTION_MISSING_CLASS)).toBe(true)
  })

  it('takes the class off again when the name turns up', () => {
    // Which is what makes a mention to something not yet made become live the
    // moment it is — without the page's markup having to change.
    const root = document.createElement('div')
    root.innerHTML = linkifyMentions('<p>@[Later]</p>')
    markMissingMentions(root, new Set())
    const anchor = root.querySelector(`[${MENTION_ATTRIBUTE}]`)!
    expect(anchor.classList.contains(MENTION_MISSING_CLASS)).toBe(true)

    markMissingMentions(root, new Set(['later']))
    expect(anchor.classList.contains(MENTION_MISSING_CLASS)).toBe(false)
  })

  it('toggles the class without replacing the text node', () => {
    // The projection holds references to these nodes. Replacing one to restyle
    // it is what would blank every anchored pin on the page.
    const root = document.createElement('div')
    root.innerHTML = linkifyMentions('<p>@[Later]</p>')
    const before = root.querySelector('a')!.firstChild

    markMissingMentions(root, new Set())

    expect(root.querySelector('a')!.firstChild).toBe(before)
  })
})
