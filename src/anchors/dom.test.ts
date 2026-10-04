// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { createAnchor } from './create'
import {
  domRangeToFlatRange,
  flatRangeToDomRange,
  projectDom,
  type DomProjection,
} from './dom'
import { resolveAnchor } from './resolve'

/** Render an article fragment into a detached container, as the reader would. */
function render(html: string): { root: Element; projection: DomProjection } {
  const host = document.createElement('div')
  host.innerHTML = html
  const root = host.firstElementChild ?? host
  return { root, projection: projectDom(root) }
}

describe('projectDom', () => {
  it('separates block elements with a space, not by gluing words together', () => {
    // Pretty-printed HTML has whitespace text nodes between blocks; minified
    // HTML does not. Both must produce the same flat text.
    const pretty = render('<article>\n  <p>quiet.</p>\n  <p>Molgar</p>\n</article>')
    const minified = render('<article><p>quiet.</p><p>Molgar</p></article>')

    expect(pretty.projection.flat.text).toContain('quiet. Molgar')
    expect(minified.projection.flat.text).toContain('quiet. Molgar')
    expect(minified.projection.flat.text).not.toContain('quiet.Molgar')
  })

  it('produces identical flat text regardless of whitespace formatting', () => {
    const pretty = render('<article>\n  <p>quiet.</p>\n  <p>Molgar</p>\n</article>')
    const minified = render('<article><p>quiet.</p><p>Molgar</p></article>')

    // Trailing whitespace differs only at the very end, where it cannot move
    // an anchor; trim before comparing.
    expect(minified.projection.flat.text.trim()).toBe(
      pretty.projection.flat.text.trim(),
    )
  })

  it('is unmoved by inline markup', () => {
    const plain = render('<p>Molgar paid the ferryman in silver.</p>')
    const bold = render('<p>Molgar paid the <strong>ferryman</strong> in silver.</p>')

    expect(bold.projection.flat.text.trim()).toBe(plain.projection.flat.text.trim())
    expect(bold.projection.flat.text.indexOf('ferryman')).toBe(
      plain.projection.flat.text.indexOf('ferryman'),
    )
  })

  it('preserves whitespace inside a code block', () => {
    const { projection } = render('<article><pre>  indented\n    deeper</pre></article>')
    expect(projection.flat.text).toContain('  indented\n    deeper')
  })

  it('treats a line break as a space', () => {
    const { projection } = render('<p>one<br>two</p>')
    expect(projection.flat.text).toContain('one two')
  })

  it('handles headings, lists and tables without gluing adjacent cells', () => {
    const { projection } = render(
      '<article><h2>Title</h2><ul><li>first</li><li>second</li></ul>' +
        '<table><tr><td>left</td><td>right</td></tr></table></article>',
    )
    expect(projection.flat.text).toContain('Title first second')
    expect(projection.flat.text).toContain('left right')
  })

  it('does not start the document with a space', () => {
    const { projection } = render('<article>\n  <p>Molgar</p>\n</article>')
    expect(projection.flat.text.startsWith(' ')).toBe(false)
  })
})

describe('range conversion', () => {
  let root: Element
  let projection: DomProjection

  beforeEach(() => {
    const rendered = render(
      '<article><p>Molgar paid the ferryman in silver.</p>' +
        '<p>The ferryman nodded.</p></article>',
    )
    root = rendered.root
    projection = rendered.projection
  })

  it('converts a DOM selection into flat offsets', () => {
    const paragraph = root.querySelector('p')!
    const textNode = paragraph.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 16)
    range.setEnd(textNode, 24)

    const flatRange = domRangeToFlatRange(projection, range)
    expect(flatRange).not.toBeNull()
    expect(projection.flat.text.slice(flatRange!.start, flatRange!.end)).toBe('ferryman')
  })

  it('round-trips a flat range back to the same text', () => {
    const start = projection.flat.text.indexOf('ferryman')
    const range = flatRangeToDomRange(projection, start, start + 8)

    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('ferryman')
  })

  it('round-trips through a range that spans a paragraph boundary', () => {
    // "silver. The" crosses the block separator, so the end boundary lands on
    // a synthetic segment and must be nudged to a real text node.
    const start = projection.flat.text.indexOf('silver.')
    const range = flatRangeToDomRange(projection, start, start + 'silver. The'.length)

    expect(range).not.toBeNull()
    const back = domRangeToFlatRange(projection, range!)
    expect(back).not.toBeNull()
    expect(projection.flat.text.slice(back!.start, back!.end)).toContain('silver.')
  })

  it('resolves an anchor created from a DOM selection back onto the right words', () => {
    // The full loop, in one test: select text in the DOM, create an anchor,
    // then resolve it against the article as it stands.
    const paragraph = root.querySelector('p')!
    const textNode = paragraph.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 16)
    range.setEnd(textNode, 24)

    const flatRange = domRangeToFlatRange(projection, range)!
    const anchor = createAnchor(projection.flat.text, flatRange.start, flatRange.end)
    expect(anchor.quote).toBe('ferryman')
    // The first occurrence, whose context is "Molgar paid the ... in silver."
    expect(anchor.startOffset).toBe(16)

    // Now the article gains a paragraph above, moving every offset below it.
    const after = render(
      '<article><p>It rained all night.</p>' +
        '<p>Molgar paid the ferryman in silver.</p>' +
        '<p>The ferryman nodded.</p></article>',
    )
    const result = resolveAnchor(after.projection.flat.text, anchor)

    expect(result.status).toBe('repaired')
    if (result.status !== 'orphaned') {
      expect(after.projection.flat.text.slice(result.start, result.end)).toBe('ferryman')
      // Still the first occurrence — the one whose context names Molgar.
      expect(after.projection.flat.text.slice(0, result.start)).toContain('Molgar')
      expect(after.projection.flat.text.slice(0, result.start)).not.toContain('nodded')
    }
  })
})
