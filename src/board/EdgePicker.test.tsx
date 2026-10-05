// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EdgePicker, placeEdgePicker } from './EdgePicker'
import { EDGE_STYLES, edgeClipPath } from './edges'

const anchor = { left: 300, top: 360, width: 80, height: 60 }

function open(over: Partial<Parameters<typeof EdgePicker>[0]> = {}) {
  const onPick = vi.fn()
  render(
    <EdgePicker
      seed={7}
      edge="clean"
      anchor={anchor}
      onPick={onPick}
      {...over}
    />,
  )
  return { onPick }
}

describe('EdgePicker', () => {
  it('offers every edge form, the no-crop one included', () => {
    // Clean is not the absence of the control, it is one of the choices — a
    // bar that omits it is a bar you cannot get back out of.
    open()

    for (const style of EDGE_STYLES) {
      expect(screen.getByTestId(`edge-${style}`), style).toBeTruthy()
    }
  })

  it('shows which crop the picture already has', () => {
    open({ edge: 'torn' })

    expect(screen.getByTestId('edge-torn').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('edge-clean').getAttribute('aria-pressed')).toBe('false')
  })

  it('hands back the style that was clicked', () => {
    const { onPick } = open()

    fireEvent.click(screen.getByTestId('edge-nibbled'))

    expect(onPick).toHaveBeenCalledWith('nibbled')
  })

  it('draws each swatch with the real crop, not an icon', () => {
    // The swatches are the generator's own output at swatch size, seeded from
    // the picture's id — so what the button shows is what picking it produces.
    // Hand-drawn swatches would drift from the presets the first time one was
    // retuned, and nothing would notice.
    open({ seed: 4242 })

    for (const style of EDGE_STYLES) {
      const face = screen.getByTestId(`edge-${style}`).querySelector('.edge-swatch-face')
      expect(face, style).toBeTruthy()
      const clip = (face as HTMLElement).style.clipPath

      expect(clip, style).toContain('polygon')
      // Same generator, same seed as the picture it belongs to.
      expect(clip, style).toBe(edgeClipPath(style, 46, 34, 4242))
    }
  })

  it('gives two different crops two different shapes', () => {
    open({ seed: 4242 })

    const face = (style: string) =>
      (screen.getByTestId(`edge-${style}`).querySelector('.edge-swatch-face') as HTMLElement)
        .style.clipPath

    expect(face('torn')).not.toBe(face('clean'))
    expect(face('stamped')).not.toBe(face('burnt'))
  })

  it('does not let a press on the bar reach the board underneath', () => {
    // The bar floats over the cork; a press meant for a swatch must not also
    // start a rubber band on the board behind it.
    const onPick = vi.fn()
    const seen = vi.fn()
    render(
      <div onPointerDown={seen}>
        <EdgePicker seed={1} edge="clean" anchor={anchor} onPick={onPick} />
      </div>,
    )

    fireEvent.pointerDown(screen.getByTestId('edge-picker'))

    expect(seen).not.toHaveBeenCalled()
  })
})

describe('placing the bar', () => {
  const viewport = { width: 1600, height: 900 }
  const bar = { width: 570, height: 65 }
  const picture = { left: 700, top: 300, width: 240, height: 180 }

  it('hangs under the picture, centred on it', () => {
    const placed = placeEdgePicker(picture, bar, viewport)

    expect(placed.side).toBe('below')
    expect(placed.top).toBe(300 + 180 + 44)
    expect(placed.left).toBe(Math.round(700 + 120 - 285))
  })

  it('flips above when it would not fit below', () => {
    // The bug: a picture low on the board put its bar past the bottom of the
    // board, which clips — and the first thing to go is the row of labels, so
    // the bar came up with ten swatches and no way to tell them apart.
    const low = { left: 700, top: 700, width: 240, height: 180 }

    const placed = placeEdgePicker(low, bar, viewport)

    expect(placed.side).toBe('above')
    expect(placed.top + bar.height).toBeLessThanOrEqual(viewport.height)
    expect(placed.top).toBe(700 - 44 - 65)
  })

  it('clamps inside the board when there is room on neither side', () => {
    // A picture taller than the space above and below it: something has to be
    // cut, and it should be the bar's far edge rather than its first swatch.
    const huge = { left: 700, top: 100, width: 240, height: 800 }

    const placed = placeEdgePicker(huge, bar, viewport)

    expect(placed.top).toBeGreaterThanOrEqual(0)
    expect(placed.top + bar.height).toBeLessThanOrEqual(viewport.height)
  })

  it('keeps a wide bar on screen beside a picture against the edge', () => {
    // A picture at the very left of the board: centring the bar on it would
    // put nine of the ten swatches off the edge.
    const edge = { left: 4, top: 300, width: 120, height: 90 }

    const placed = placeEdgePicker(edge, bar, viewport)

    expect(placed.left).toBeGreaterThanOrEqual(0)
    expect(placed.left + bar.width).toBeLessThanOrEqual(viewport.width)
  })
})
