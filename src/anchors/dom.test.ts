// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { createAnchor } from './create'
import {
  domRangeToFlatRange,
  flatRangeToDomRange,
  projectDom,
  rangeToContainerRects,
  type DomProjection,
} from './dom'
import { resolveAnchor } from './resolve'

function render(html: string): { root: Element; projection: DomProjection } {
  const host = document.createElement('div')
  host.innerHTML = html
  const root = host.firstElementChild ?? host
  return { root, projection: projectDom(root) }
}

describe('projectDom', () => {
  it('separates block elements with a space, not by gluing words together', () => {
    const pretty = render('<article>\n  <p>quiet.</p>\n  <p>Molgar</p>\n</article>')
    const minified = render('<article><p>quiet.</p><p>Molgar</p></article>')

    expect(pretty.projection.flat.text).toContain('quiet. Molgar')
    expect(minified.projection.flat.text).toContain('quiet. Molgar')
    expect(minified.projection.flat.text).not.toContain('quiet.Molgar')
  })

  it('produces identical flat text regardless of whitespace formatting', () => {
    const pretty = render('<article>\n  <p>quiet.</p>\n  <p>Molgar</p>\n</article>')
    const minified = render('<article><p>quiet.</p><p>Molgar</p></article>')

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
    const start = projection.flat.text.indexOf('silver.')
    const range = flatRangeToDomRange(projection, start, start + 'silver. The'.length)

    expect(range).not.toBeNull()
    const back = domRangeToFlatRange(projection, range!)
    expect(back).not.toBeNull()
    expect(projection.flat.text.slice(back!.start, back!.end)).toContain('silver.')
  })

  it('resolves an anchor created from a DOM selection back onto the right words', () => {
    const paragraph = root.querySelector('p')!
    const textNode = paragraph.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 16)
    range.setEnd(textNode, 24)

    const flatRange = domRangeToFlatRange(projection, range)!
    const anchor = createAnchor(projection.flat.text, flatRange.start, flatRange.end)
    expect(anchor.quote).toBe('ferryman')
    expect(anchor.startOffset).toBe(16)

    const after = render(
      '<article><p>It rained all night.</p>' +
        '<p>Molgar paid the ferryman in silver.</p>' +
        '<p>The ferryman nodded.</p></article>',
    )
    const result = resolveAnchor(after.projection.flat.text, anchor)

    expect(result.status).toBe('repaired')
    if (result.status !== 'orphaned') {
      expect(after.projection.flat.text.slice(result.start, result.end)).toBe('ferryman')
      expect(after.projection.flat.text.slice(0, result.start)).toContain('Molgar')
      expect(after.projection.flat.text.slice(0, result.start)).not.toContain('nodded')
    }
  })
})

describe('rangeToContainerRects', () => {
  function fakeRange(rects: { left: number; top: number; width: number; height: number }[]) {
    return { getClientRects: () => rects } as unknown as Range
  }

  function fakeContainer(rect: { left: number; top: number; width: number; height: number }) {
    return { getBoundingClientRect: () => rect } as unknown as Element
  }

  it('expresses a rect relative to the container', () => {
    const range = fakeRange([{ left: 150, top: 220, width: 40, height: 20 }])
    const container = fakeContainer({ left: 100, top: 200, width: 720, height: 900 })

    expect(rangeToContainerRects(range, container, 1)).toEqual([
      { x: 50, y: 20, width: 40, height: 20 },
    ])
  })

  it('divides the zoom back out, so the result is in the container own pixels', () => {
    const zoom = 1.31
    const range = fakeRange([
      { left: 100 + 50 * zoom, top: 200 + 20 * zoom, width: 40 * zoom, height: 20 * zoom },
    ])
    const container = fakeContainer({ left: 100, top: 200, width: 720 * zoom, height: 900 * zoom })

    const [rect] = rangeToContainerRects(range, container, zoom)

    expect(rect.x).toBeCloseTo(50, 6)
    expect(rect.y).toBeCloseTo(20, 6)
    expect(rect.width).toBeCloseTo(40, 6)
    expect(rect.height).toBeCloseTo(20, 6)
  })

  it('is unaffected by which zoom the measurement was taken at', () => {
    const rangeAt = (zoom: number) =>
      fakeRange([{ left: 100 + 50 * zoom, top: 200 + 20 * zoom, width: 40 * zoom, height: 20 * zoom }])
    const containerAt = (zoom: number) =>
      fakeContainer({ left: 100, top: 200, width: 720 * zoom, height: 900 * zoom })

    const at100 = rangeToContainerRects(rangeAt(1), containerAt(1), 1)
    const at250 = rangeToContainerRects(rangeAt(2.5), containerAt(2.5), 2.5)

    expect(at250).toEqual(at100)
  })

  it('returns one rect per line box, in order', () => {
    const range = fakeRange([
      { left: 100, top: 200, width: 700, height: 20 },
      { left: 100, top: 224, width: 320, height: 20 },
    ])
    const container = fakeContainer({ left: 0, top: 0, width: 720, height: 900 })

    expect(rangeToContainerRects(range, container, 1)).toHaveLength(2)
  })

  it('degrades to nothing where the environment cannot measure at all', () => {
    const host = document.createElement('div')
    host.innerHTML = '<article><p>Molgar paid the ferryman.</p></article>'
    const container = host.firstElementChild as Element

    const noRects = {
      getClientRects: undefined,
    } as unknown as Range
    expect(rangeToContainerRects(noRects, container, 1)).toEqual([])

    const noBox = {} as unknown as Element
    const range = document.createRange()
    range.selectNodeContents(host)
    expect(rangeToContainerRects(range, noBox, 1)).toEqual([])
  })

  it('treats a degenerate scale as 1 rather than placing everything at infinity', () => {
    const range = fakeRange([{ left: 150, top: 220, width: 40, height: 20 }])
    const container = fakeContainer({ left: 100, top: 200, width: 720, height: 900 })

    expect(rangeToContainerRects(range, container, 0)).toEqual([
      { x: 50, y: 20, width: 40, height: 20 },
    ])
  })
})
