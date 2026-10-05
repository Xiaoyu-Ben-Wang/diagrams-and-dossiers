import { describe, expect, it } from 'vitest'

import { placePopup } from './textarea-caret'

/**
 * `caretRect` itself is a measurement — a mirror div, a forced layout and a
 * `getBoundingClientRect`, all of which jsdom reports as zero. What is left to
 * test here is the arithmetic that decides which corner the answer becomes, and
 * that is where the interesting cases are: a caret at the bottom of the pane,
 * which is what the list appearing at the top of it was about.
 */

/** A 380px pane with a 96px caret 400px down it. */
const PANE = { width: 380, height: 460 }
const LIST = { width: 240, height: 120 }

const caretAt = (top: number, left = 100) => ({ left, top, height: 16 })

describe('putting a popup under a caret', () => {
  it('hangs it below the caret, a gap clear of the line', () => {
    expect(placePopup(caretAt(100), LIST, PANE)).toEqual({ left: 100, top: 120 })
  })

  it('flips it above a caret with no room below', () => {
    // The reported bug: an `@` typed on the last line of a long document. There
    // is no room under it, so the list goes above rather than over the edge.
    const at = placePopup(caretAt(440), LIST, PANE)

    expect(at.top).toBe(440 - LIST.height - 4)
    expect(at.top + LIST.height).toBeLessThan(440)
  })

  it('goes below when it exactly fits, rather than flipping early', () => {
    // At the boundary — the list's bottom landing on the margin — below still
    // fits, and `below <= lowest` is what says so. Flipping a frame early is a
    // list that jumps over the caret for no reason the person can see.
    const caret = caretAt(PANE.height - LIST.height - 4 - 16 - 4)

    expect(placePopup(caret, LIST, PANE).top).toBe(PANE.height - LIST.height - 4)
  })

  it('keeps it inside the pane on the right', () => {
    // The pane is `overflow-hidden`, so past its right edge the list is clipped
    // rather than spilled — the clamp keeps the words readable.
    expect(placePopup(caretAt(100, 370), LIST, PANE).left).toBe(PANE.width - LIST.width - 4)
  })

  it('never pushes it off the left for a caret at the very edge', () => {
    expect(placePopup(caretAt(100, -20), LIST, PANE).left).toBe(4)
  })

  it('stays in the pane even when it does not fit either way', () => {
    // A pane shorter than the list. Something has to give, and being clipped by
    // the pane's own edge is the failure to avoid: it is scrolled instead.
    const short = { width: 380, height: 80 }
    const at = placePopup(caretAt(40), LIST, short)

    expect(at.top).toBe(4)
    expect(at.left).toBeGreaterThanOrEqual(4)
  })
})
