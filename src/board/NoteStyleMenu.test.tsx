// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NoteStyleMenu } from './NoteStyleMenu'
import { POST_IT_COLORS } from './tuning'
import { NOTE_STYLES } from '../model/types'

const anchor = { left: 300, top: 360, width: 80, height: 60 }

function open(over: Partial<Parameters<typeof NoteStyleMenu>[0]> = {}) {
  const onPickStyle = vi.fn()
  const onPickColor = vi.fn()
  const onClose = vi.fn()
  render(
    <NoteStyleMenu
      anchor={anchor}
      style="plain"
      color={POST_IT_COLORS[0].color}
      onPickStyle={onPickStyle}
      onPickColor={onPickColor}
      onClose={onClose}
      {...over}
    />,
  )
  return { onPickStyle, onPickColor, onClose }
}

describe('NoteStyleMenu', () => {
  it('offers every paper, plain included', () => {
    open()

    for (const style of NOTE_STYLES) {
      expect(screen.getByTestId(`post-it-paper-${style}`), style).toBeTruthy()
    }
  })

  it('offers every colour in the palette', () => {
    open()

    for (const entry of POST_IT_COLORS) {
      expect(screen.getByTestId(`post-it-color-${entry.name.toLowerCase()}`)).toBeTruthy()
    }
  })

  it('shows the pair the note already has', () => {
    open({ style: 'grid', color: POST_IT_COLORS[2].color })

    expect(screen.getByTestId('post-it-paper-grid').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('post-it-paper-plain').getAttribute('aria-pressed')).toBe('false')
    expect(
      screen.getByTestId('post-it-color-stone').getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('hands back the paper that was clicked, and stays open', () => {
    const { onPickStyle, onClose } = open()

    fireEvent.click(screen.getByTestId('post-it-paper-taped'))

    expect(onPickStyle).toHaveBeenCalledWith('taped')
    // Both a paper and a colour are chosen before it is dismissed.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('hands back the colour that was clicked, and stays open', () => {
    const { onPickColor, onClose } = open()

    fireEvent.click(screen.getByTestId('post-it-color-sage'))

    expect(onPickColor).toHaveBeenCalledWith(POST_IT_COLORS[3].color)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not let a press in the menu reach the board underneath', () => {
    const seen = vi.fn()
    render(
      <div onPointerDown={seen}>
        <NoteStyleMenu
          anchor={anchor}
          style="plain"
          color={POST_IT_COLORS[0].color}
          onPickStyle={vi.fn()}
          onPickColor={vi.fn()}
          onClose={vi.fn()}
        />
      </div>,
    )

    fireEvent.pointerDown(screen.getByTestId('post-it-style-menu'))

    expect(seen).not.toHaveBeenCalled()
  })

  it('closes on Escape, and stops the key reaching the document', () => {
    const { onClose } = open()
    // The board listens for Escape on the document, and must not also act on it.
    const seen = vi.fn()
    document.addEventListener('keydown', seen)

    fireEvent.keyDown(screen.getByTestId('post-it-style-menu'), { key: 'Escape' })

    document.removeEventListener('keydown', seen)
    expect(onClose).toHaveBeenCalled()
    expect(seen).not.toHaveBeenCalled()
  })

  it('closes when the press lands outside it', () => {
    const { onClose } = open()
    const elsewhere = document.createElement('div')
    document.body.append(elsewhere)

    fireEvent.pointerDown(elsewhere)

    expect(onClose).toHaveBeenCalled()
  })

  it('ignores a press on the trigger, so the trigger can toggle', () => {
    const { onClose } = open()
    const trigger = document.createElement('button')
    trigger.setAttribute('data-note-style-menu-trigger', '')
    document.body.append(trigger)

    fireEvent.pointerDown(trigger)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('takes focus on open and gives it back when it goes away', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()

    const { unmount } = render(
      <NoteStyleMenu
        anchor={anchor}
        style="plain"
        color={POST_IT_COLORS[0].color}
        onPickStyle={vi.fn()}
        onPickColor={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(document.activeElement).toBe(screen.getByTestId('post-it-style-menu'))

    unmount()

    expect(document.activeElement).toBe(trigger)
  })
})
