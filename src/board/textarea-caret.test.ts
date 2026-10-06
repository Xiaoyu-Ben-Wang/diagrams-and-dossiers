import { describe, expect, it } from 'vitest'

import { placePopup } from './textarea-caret'

// `caretRect` cannot be tested here: jsdom reports every measurement as zero.
const PANE = { width: 380, height: 460 }
const LIST = { width: 240, height: 120 }

const caretAt = (top: number, left = 100) => ({ left, top, height: 16 })

describe('putting a popup under a caret', () => {
  it('hangs it below the caret, a gap clear of the line', () => {
    expect(placePopup(caretAt(100), LIST, PANE)).toEqual({ left: 100, top: 120 })
  })

  it('flips it above a caret with no room below', () => {
    const at = placePopup(caretAt(440), LIST, PANE)

    expect(at.top).toBe(440 - LIST.height - 4)
    expect(at.top + LIST.height).toBeLessThan(440)
  })

  it('goes below when it exactly fits, rather than flipping early', () => {
    const caret = caretAt(PANE.height - LIST.height - 4 - 16 - 4)

    expect(placePopup(caret, LIST, PANE).top).toBe(PANE.height - LIST.height - 4)
  })

  it('keeps it inside the pane on the right', () => {
    expect(placePopup(caretAt(100, 370), LIST, PANE).left).toBe(PANE.width - LIST.width - 4)
  })

  it('never pushes it off the left for a caret at the very edge', () => {
    expect(placePopup(caretAt(100, -20), LIST, PANE).left).toBe(4)
  })

  it('stays in the pane even when it does not fit either way', () => {
    const short = { width: 380, height: 80 }
    const at = placePopup(caretAt(40), LIST, short)

    expect(at.top).toBe(4)
    expect(at.left).toBeGreaterThanOrEqual(4)
  })
})
