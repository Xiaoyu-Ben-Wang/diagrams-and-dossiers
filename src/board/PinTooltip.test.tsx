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

  it('renders through a portal so the board viewport cannot clip it', () => {
    show()
    expect(screen.getByRole('tooltip').parentElement).toBe(document.body)
  })

  it('carries the id its tack points aria-describedby at', () => {
    show()
    expect(screen.getByRole('tooltip').id).toBe(pinTooltipId(PIN.id))
  })

  it('omits the quote when the pin has none', () => {
    show({ ...PIN, quote: '' })

    expect(screen.queryByText(/already broken/)).toBeNull()
    expect(screen.getByText(/Marnie swears she locked it/)).toBeTruthy()
  })

  it('omits the description when the note is empty', () => {
    show({ ...PIN, body: '' })

    expect(screen.queryByText(/Marnie swears/)).toBeNull()
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
