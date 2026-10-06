// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { articleIdFromRange, entityIdFromElement, px, withinSlop } from './view'

function dom(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

describe('entityIdFromElement', () => {
  it('resolves a page from the sheet itself', () => {
    const host = dom('<div data-entity-id="page-1" data-board-entity="article"></div>')
    expect(entityIdFromElement(host.firstElementChild!)).toBe('page-1')
  })

  it('prefers the innermost carrier when entities are nested', () => {
    // A tack is drawn inside its page, so the innermost carrier must win.
    const host = dom(
      '<div data-entity-id="page-1" data-board-entity="article">' +
        '<button data-pin-id="pin-9" data-board-entity="pin"></button>' +
        '</div>',
    )
    const pin = host.querySelector('[data-pin-id]')!
    expect(entityIdFromElement(pin)).toBe('pin-9')

    pin.innerHTML = '<span class="glyph"></span>'
    expect(entityIdFromElement(pin.firstElementChild!)).toBe('pin-9')
  })

  it('still honours the older per-kind attributes', () => {
    const host = dom(
      '<div><div data-post-it-id="note-2" data-entity-id="note-2"><span></span></div></div>',
    )
    expect(entityIdFromElement(host.querySelector('span')!)).toBe('note-2')
  })

  it('is null for bare cork', () => {
    const host = dom('<div class="board"><span></span></div>')
    expect(entityIdFromElement(host.querySelector('span')!)).toBeNull()
  })
})

describe('articleIdFromRange', () => {
  it('attributes a caret to the page its text is in', () => {
    const host = dom(
      '<div data-article-id="page-1"><p>first</p></div>' +
        '<div data-article-id="page-2"><p>second</p></div>',
    )
    document.body.append(host)
    try {
      const target = host.querySelectorAll('p')[1].firstChild as Text
      const range = document.createRange()
      range.setStart(target, 1)
      range.collapse(true)

      expect(articleIdFromRange(range)).toBe('page-2')
    } finally {
      host.remove()
    }
  })

  it('is null for text that is in no page', () => {
    const host = dom('<div><p>loose</p></div>')
    document.body.append(host)
    try {
      const range = document.createRange()
      range.setStart(host.querySelector('p')!.firstChild as Text, 0)
      range.collapse(true)

      expect(articleIdFromRange(range)).toBeNull()
    } finally {
      host.remove()
    }
  })
})

describe('withinSlop', () => {
  const rect = { x: 100, y: 50, width: 80, height: 20 }

  it('forgives a point just outside the words on any side', () => {
    expect(withinSlop({ x: 92, y: 60 }, rect, 18)).toBe(true)
    expect(withinSlop({ x: 188, y: 60 }, rect, 18)).toBe(true)
    expect(withinSlop({ x: 140, y: 34 }, rect, 18)).toBe(true)
    expect(withinSlop({ x: 140, y: 88 }, rect, 18)).toBe(true)
  })

  it('does not forgive a point beyond the slack', () => {
    expect(withinSlop({ x: 200, y: 60 }, rect, 18)).toBe(false)
    expect(withinSlop({ x: 140, y: 100 }, rect, 18)).toBe(false)
  })
})

describe('px', () => {
  it('reads a length, and reads nothing as zero', () => {
    expect(px('48px')).toBe(48)
    expect(px('12.5px')).toBe(12.5)
    // jsdom reports computed lengths as empty strings; parseFloat would yield NaN.
    expect(px('')).toBe(0)
    expect(px('auto')).toBe(0)
  })
})
