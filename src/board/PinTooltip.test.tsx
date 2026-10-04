// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PIN_TOOLTIP_DELAY_MS,
  PIN_TOOLTIP_MARGIN,
  PinTooltip,
  pinTooltipId,
  placeTooltip,
  type PinTooltipPin,
} from './PinTooltip'

const PIN: PinTooltipPin = {
  id: 'pin-1',
  quote: 'the lock was already broken',
  body: 'Marnie swears she locked it before the bell.',
  dateLabel: 'Session 12, 1492 DR',
}

/**
 * The tack the pointer is on. It lives outside React because the component's
 * contract is an element plus a pin, not a render tree — this is the same
 * element the integrator hands over from `event.currentTarget`.
 */
let anchor: HTMLButtonElement

beforeEach(() => {
  vi.useFakeTimers()
  anchor = document.createElement('button')
  document.body.appendChild(anchor)
})

afterEach(() => {
  vi.useRealTimers()
  anchor.remove()
})

/** Renders the card and waits out the hover delay. */
function show(pin: PinTooltipPin = PIN, delay: number = PIN_TOOLTIP_DELAY_MS): void {
  render(<PinTooltip pin={pin} anchor={anchor} delay={delay} />)
  act(() => {
    vi.advanceTimersByTime(delay)
  })
}

describe('PinTooltip', () => {
  it('waits out the delay before showing anything', () => {
    render(<PinTooltip pin={PIN} anchor={anchor} />)
    expect(screen.queryByRole('tooltip')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(PIN_TOOLTIP_DELAY_MS - 1)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('appears once the delay elapses', () => {
    show()
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('honours a tuned delay from the caller', () => {
    render(<PinTooltip pin={PIN} anchor={anchor} delay={40} />)
    act(() => {
      vi.advanceTimersByTime(39)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('shows within 200ms by default, far ahead of the native tooltip', () => {
    // The whole reason the card exists: ~1s of `title` is too slow to scan by.
    expect(PIN_TOOLTIP_DELAY_MS).toBeLessThan(200)

    render(<PinTooltip pin={PIN} anchor={anchor} />)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('shows the quote, the description and the date label', () => {
    show()
    const card = screen.getByRole('tooltip')

    expect(card.textContent).toContain('the lock was already broken')
    expect(card.textContent).toContain('Marnie swears she locked it before the bell.')
    expect(card.textContent).toContain('Session 12, 1492 DR')
  })

  it('renders nothing without a pin', () => {
    render(<PinTooltip pin={null} anchor={anchor} />)
    act(() => {
      vi.advanceTimersByTime(PIN_TOOLTIP_DELAY_MS * 2)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('renders nothing without an anchor to measure', () => {
    render(<PinTooltip pin={PIN} anchor={null} />)
    act(() => {
      vi.advanceTimersByTime(PIN_TOOLTIP_DELAY_MS * 2)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('renders through a portal so the board viewport cannot clip it', () => {
    show()
    expect(screen.getByRole('tooltip').parentElement).toBe(document.body)
  })

  it('applies the measured placement to the card', () => {
    // jsdom reports every box as zero, so the component stays unplaced and the
    // wiring from measurement to inline style would go untested. Stand in fake
    // boxes — a 14px tack, a 240x96 card — to hold it to that contract.
    const stub = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function measured(this: Element) {
      const box =
        this === anchor
          ? { left: 500, top: 300, width: 14, height: 14 }
          : { left: 0, top: 0, width: 240, height: 96 }
      return {
        ...box,
        right: box.left + box.width,
        bottom: box.top + box.height,
        x: box.left,
        y: box.top,
        toJSON: () => box,
      } as DOMRect
    }
    try {
      show()
      const card = screen.getByRole('tooltip')
      expect(card.classList.contains('pin-tooltip--placed')).toBe(true)
      expect(card.style.left).toBe('387px')
      expect(card.style.top).toBe('324px')
      expect(card.style.getPropertyValue('--tail-x')).toBe('120px')
    } finally {
      Element.prototype.getBoundingClientRect = stub
    }
  })

  it('carries the id its tack points aria-describedby at', () => {
    show()
    expect(screen.getByRole('tooltip').id).toBe(pinTooltipId(PIN.id))
  })

  it('omits the quote when the pin has none', () => {
    show({ ...PIN, quote: '' })

    // The quote element itself, not just its text: a free pin must not carry
    // an empty quote line.
    const card = screen.getByRole('tooltip')
    expect(card.querySelector('.pin-tooltip__quote')).toBeNull()
    expect(screen.getByText(/Marnie swears she locked it/)).toBeTruthy()
  })

  it('omits the description when the note is empty', () => {
    show({ ...PIN, body: '' })

    const card = screen.getByRole('tooltip')
    expect(card.querySelector('.pin-tooltip__body')).toBeNull()
    expect(screen.getByText(/already broken/)).toBeTruthy()
  })
})

describe('dismissal', () => {
  it('hides when the pointer leaves the pin', () => {
    show()
    fireEvent.pointerLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('cancels a reveal that is still pending when the pointer leaves', () => {
    render(<PinTooltip pin={PIN} anchor={anchor} />)
    act(() => {
      vi.advanceTimersByTime(PIN_TOOLTIP_DELAY_MS / 2)
    })

    fireEvent.pointerLeave(anchor)
    act(() => {
      vi.advanceTimersByTime(PIN_TOOLTIP_DELAY_MS * 4)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('hides on Escape', () => {
    show()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('hides when the board scrolls', () => {
    show()
    fireEvent.scroll(window)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('hides when a scrolling pane around the board scrolls', () => {
    show()
    const pane = document.createElement('div')
    document.body.appendChild(pane)

    // A real scroll does not bubble, so only a capture listener on window can
    // hear a pane's scroll — the plain window-target scroll above would pass
    // even without capture.
    fireEvent(pane, new Event('scroll'))
    expect(screen.queryByRole('tooltip')).toBeNull()
    pane.remove()
  })

  it('shows again when the pointer re-enters after Escape', () => {
    // Escape must silence the card, not the pin: leaving and coming back is a
    // fresh hover, and the delay effect has to re-arm for it.
    show()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.pointerEnter(anchor)
    act(() => {
      vi.advanceTimersByTime(PIN_TOOLTIP_DELAY_MS)
    })
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })
})

describe('placeTooltip', () => {
  const viewport = { width: 1024, height: 768 }
  const size = { width: 240, height: 96 }
  const pin = (left: number, top: number) => ({ left, top, width: 14, height: 14 })

  it('sits centred below a pin with room all round', () => {
    expect(placeTooltip(pin(500, 300), size, viewport)).toEqual({
      left: 387,
      top: 324,
      side: 'below',
      tailX: 120,
    })
  })

  it('flips to the side of a pin near the right edge instead of hanging off it', () => {
    expect(placeTooltip(pin(1000, 300), size, viewport)).toEqual({
      left: 750,
      top: 324,
      side: 'below',
      tailX: 226,
    })
  })

  it('flips above a pin near the bottom edge instead of running off it', () => {
    expect(placeTooltip(pin(500, 740), size, viewport)).toEqual({
      left: 387,
      top: 634,
      side: 'above',
      tailX: 120,
    })
  })

  it('keeps a pin in the bottom-right corner on screen on both axes', () => {
    const placed = placeTooltip(pin(1000, 740), size, viewport)

    expect(placed.left + size.width).toBeLessThanOrEqual(viewport.width - PIN_TOOLTIP_MARGIN)
    expect(placed.top + size.height).toBeLessThanOrEqual(viewport.height - PIN_TOOLTIP_MARGIN)
    expect(placed.left).toBeGreaterThanOrEqual(PIN_TOOLTIP_MARGIN)
    expect(placed.top).toBeGreaterThanOrEqual(PIN_TOOLTIP_MARGIN)
  })

  it('flips to the right of a pin hugging the left edge', () => {
    expect(placeTooltip(pin(0, 300), size, viewport)).toEqual({
      left: 24,
      top: 324,
      side: 'below',
      tailX: 14,
    })
  })

  it('drops to the margin when the card is wider and taller than the viewport', () => {
    // No flip can help here; losing the far edge beats losing the first line.
    expect(placeTooltip(pin(500, 300), { width: 1200, height: 900 }, viewport)).toEqual({
      left: PIN_TOOLTIP_MARGIN,
      top: PIN_TOOLTIP_MARGIN,
      side: 'below',
      tailX: 499,
    })
  })

  it('leaves a custom gap between the pin and the card', () => {
    const placed = placeTooltip(pin(500, 300), size, viewport, 24)
    expect(placed.top).toBe(300 + 14 + 24)
  })
})
