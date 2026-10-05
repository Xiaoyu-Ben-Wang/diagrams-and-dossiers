// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EdgePicker } from './EdgePicker'
import { EDGE_STYLES, edgeClipPath } from './edges'

const box = { x: 100, y: 200, width: 240, height: 120 }

function open(over: Partial<Parameters<typeof EdgePicker>[0]> = {}) {
  const onPick = vi.fn()
  render(
    <EdgePicker
      seed={7}
      edge="clean"
      box={box}
      tilt={0}
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
        <EdgePicker seed={1} edge="clean" box={box} tilt={0} onPick={onPick} />
      </div>,
    )

    fireEvent.pointerDown(screen.getByTestId('edge-picker'))

    expect(seen).not.toHaveBeenCalled()
  })
})
