// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { linkifyHtml, wikiLinkFromEvent } from './linkify'

const resolveBoth = (target: string) =>
  target.toLowerCase() === 'molgar the pale' ? 'molgar-the-pale' : null

describe('linkifyHtml', () => {
  it('leaves html without wikilinks untouched', () => {
    const html = '<p>Just prose about a ferryman.</p>'
    expect(linkifyHtml(html, { resolve: resolveBoth })).toBe(html)
  })

  /** Render linkified html and return both the markup and its text. */
  function render(html: string) {
    const output = linkifyHtml(html, { resolve: resolveBoth })
    const host = document.createElement('div')
    host.innerHTML = output
    return { output, host, text: host.textContent ?? '' }
  }

  it('turns a wikilink into an anchor', () => {
    const { output } = render('<p>See [[Molgar the Pale]] now.</p>')
    expect(output).toContain('<a')
    expect(output).toContain('data-wiki-slug="molgar-the-pale"')
    expect(output).toContain('>Molgar the Pale</a>')
  })

  it('gives the anchor a real href, so it is keyboard reachable', () => {
    // Without an href the anchor is not focusable, which would make every
    // wikilink unusable without a mouse.
    const host = document.createElement('div')
    host.innerHTML = linkifyHtml('<p>[[Molgar the Pale]]</p>', { resolve: resolveBoth })
    expect(host.querySelector('a')?.getAttribute('href')).toContain('molgar-the-pale')
  })

  it('drops the brackets from the visible text', () => {
    // This is the ordering constraint that matters: linkifying changes the
    // text, which is exactly why it must run before the article is projected
    // for anchoring. Asserted on textContent, since the markup now splits the
    // label into its own element.
    const { text, output } = render('<p>See [[Molgar the Pale]].</p>')
    expect(text).toBe('See Molgar the Pale.')
    expect(output).not.toContain('[[')
    expect(output).not.toContain(']]')
  })

  it('uses the alias as the label but the target as the link', () => {
    const html = linkifyHtml('<p>[[Molgar the Pale|the pale one]]</p>', { resolve: resolveBoth })
    expect(html).toContain('>the pale one</a>')
    expect(html).toContain('data-wiki-target="Molgar the Pale"')
    expect(html).toContain('data-wiki-slug="molgar-the-pale"')
  })

  it('marks an unresolved link rather than dropping it', () => {
    // A wiki that silently swallows your typo is a wiki where you never find
    // out you made one.
    const html = linkifyHtml('<p>[[Nobody At All]]</p>', { resolve: resolveBoth })
    expect(html).toContain('wikilink-missing')
    expect(html).toContain('>Nobody At All</a>')
    expect(html).not.toContain('data-wiki-slug')
  })

  it('carries the section through', () => {
    const html = linkifyHtml('<p>[[Molgar the Pale#History]]</p>', { resolve: resolveBoth })
    expect(html).toContain('data-wiki-section="History"')
  })

  it('does not linkify inside a code block', () => {
    const html = linkifyHtml('<pre><code>[[Molgar the Pale]]</code></pre>', {
      resolve: resolveBoth,
    })
    expect(html).not.toContain('<a')
    expect(html).toContain('[[Molgar the Pale]]')
  })

  it('does not linkify inside inline code', () => {
    const html = linkifyHtml('<p>Use <code>[[Target]]</code> like [[Molgar the Pale]].</p>', {
      resolve: resolveBoth,
    })
    expect(html).toContain('<code>[[Target]]</code>')
    expect(html.match(/<a /g)).toHaveLength(1)
  })

  it('never treats an attribute value as link syntax', () => {
    // The reason this works on a parsed DOM rather than on the HTML string.
    const html = linkifyHtml('<img alt="[[Molgar the Pale]]" src="x.png">', {
      resolve: resolveBoth,
    })
    expect(html).not.toContain('<a')
  })

  it('preserves surrounding text exactly', () => {
    const html = linkifyHtml('<p>Before [[Molgar the Pale]] after.</p>', { resolve: resolveBoth })
    expect(html).toContain('Before ')
    expect(html).toContain(' after.')
  })

  it('handles several links in one paragraph', () => {
    const html = linkifyHtml('<p>[[Molgar the Pale]] and [[Nobody]] and [[Molgar the Pale]].</p>', {
      resolve: resolveBoth,
    })
    expect(html.match(/<a /g)).toHaveLength(3)
  })

  it('preserves nested element structure', () => {
    const html = linkifyHtml('<p>Some <strong>bold</strong> and [[Molgar the Pale]].</p>', {
      resolve: resolveBoth,
    })
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<a ')
  })

  it('leaves an unclosed link alone', () => {
    const html = linkifyHtml('<p>Broken [[Molgar</p>', { resolve: resolveBoth })
    expect(html).not.toContain('<a ')
  })

  it('does not parse a label as markup', () => {
    // The label is author-written text. Escaped angle brackets in the source
    // must stay text — the anchor is built with textContent, never innerHTML.
    const { host, text } = render('<p>[[Molgar the Pale|&lt;b&gt;x&lt;/b&gt;]]</p>')
    expect(text).toBe('<b>x</b>')
    expect(host.querySelector('b')).toBeNull()
  })
})

describe('wikiLinkFromEvent', () => {
  it('reads the slug off a click', () => {
    // Delegation rather than listeners: the linkify step returns an HTML
    // string, and listeners do not survive serialization.
    const host = document.createElement('div')
    host.innerHTML = linkifyHtml('<p>[[Molgar the Pale]]</p>', { resolve: resolveBoth })
    document.body.appendChild(host)

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    host.querySelector('a')!.dispatchEvent(event)

    expect(wikiLinkFromEvent(event)).toEqual({
      slug: 'molgar-the-pale',
      target: 'Molgar the Pale',
      section: null,
      resolved: true,
    })
    host.remove()
  })

  it('falls back to the raw target when nothing resolved', () => {
    const host = document.createElement('div')
    host.innerHTML = linkifyHtml('<p>[[Nobody At All]]</p>', { resolve: resolveBoth })
    document.body.appendChild(host)

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    host.querySelector('a')!.dispatchEvent(event)

    expect(wikiLinkFromEvent(event)).toEqual({
      slug: 'Nobody At All',
      target: 'Nobody At All',
      section: null,
      resolved: false,
    })
    host.remove()
  })

  it('carries the section', () => {
    const host = document.createElement('div')
    host.innerHTML = linkifyHtml('<p>[[Molgar the Pale#History]]</p>', { resolve: resolveBoth })
    document.body.appendChild(host)

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    host.querySelector('a')!.dispatchEvent(event)

    expect(wikiLinkFromEvent(event)?.section).toBe('History')
    host.remove()
  })

  it('returns null for a click that is not on a wikilink', () => {
    const host = document.createElement('div')
    host.innerHTML = '<p>plain text</p>'
    document.body.appendChild(host)

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    host.querySelector('p')!.dispatchEvent(event)

    expect(wikiLinkFromEvent(event)).toBeNull()
    host.remove()
  })

  it('finds the anchor when the click lands on a child of it', () => {
    const host = document.createElement('div')
    host.innerHTML = linkifyHtml('<p>[[Molgar the Pale]]</p>', { resolve: resolveBoth })
    document.body.appendChild(host)

    const anchor = host.querySelector('a')!
    const inner = anchor.firstChild!
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    inner.dispatchEvent(event)

    expect(wikiLinkFromEvent(event)?.slug).toBe('molgar-the-pale')
    host.remove()
  })
})
