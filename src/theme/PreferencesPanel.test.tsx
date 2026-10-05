// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PREFERENCES_PANEL_ID, PreferencesPanel } from './PreferencesPanel'
import { DEFAULT_PREFERENCES, getPreferences, resetPreferences, setPreferences, usePreferences } from './preferences'

afterEach(() => {
  // Wrapped because the store reset can notify components still mounted from
  // the test body; unwrapped it produces React act warnings.
  act(() => {
    resetPreferences()
  })
})

function panel(
  overrides: {
    onClose?: () => void
    onClearBoard?: () => void
    onExportBoard?: () => void
    onImportBoard?: (file: File) => Promise<string | null>
  } = {},
) {
  const onClose = overrides.onClose ?? vi.fn()
  const onClearBoard = overrides.onClearBoard ?? vi.fn()
  const onExportBoard = overrides.onExportBoard ?? vi.fn()
  const onImportBoard = overrides.onImportBoard ?? vi.fn(async () => null)
  render(
    <PreferencesPanel
      open
      onClose={onClose}
      onClearBoard={onClearBoard}
      onExportBoard={onExportBoard}
      onImportBoard={onImportBoard}
    />,
  )
  return { onClose, onClearBoard, onExportBoard, onImportBoard }
}

/** A trigger with the aria wiring the integrator is told to give the real one. */
function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" aria-expanded={open} aria-controls={PREFERENCES_PANEL_ID} onClick={() => setOpen(true)}>
        Open preferences
      </button>
      <PreferencesPanel
        open={open}
        onClose={() => setOpen(false)}
        onClearBoard={vi.fn()}
        onExportBoard={vi.fn()}
        onImportBoard={vi.fn(async () => null)}
      />
    </>
  )
}

function armClear() {
  fireEvent.click(screen.getByRole('button', { name: 'Clear board…' }))
}

function typedConfirmation(): HTMLInputElement {
  return screen.getByLabelText(/type clear to confirm/i) as HTMLInputElement
}

function finalClearButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^Clear board$/ }) as HTMLButtonElement
}

describe('PreferencesPanel dialog behaviour', () => {
  it('closes when escape is pressed', () => {
    const { onClose } = panel()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves focus into the dialog when it opens', () => {
    panel()
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('hands focus back to the trigger when it closes', () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open preferences' })
    trigger.focus()
    fireEvent.click(trigger)

    expect(screen.queryByRole('dialog')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on a backdrop press but not on a press inside the panel', () => {
    const onClose = vi.fn()
    render(
      <PreferencesPanel
        open
        onClose={onClose}
        onClearBoard={vi.fn()}
        onExportBoard={vi.fn()}
        onImportBoard={vi.fn(async () => null)}
      />,
    )

    fireEvent.pointerDown(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.pointerDown(document.querySelector('.prefs-backdrop') as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps escape working while the confirmation field has focus', () => {
    const { onClose } = panel()
    armClear()
    typedConfirmation().focus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('tabs from the dialog container straight into the first control', () => {
    panel()
    expect(document.activeElement).toBe(screen.getByRole('dialog'))

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close preferences' }))
  })

  it('wraps tab forward from the last control and backward from the first', () => {
    panel()
    const first = screen.getByRole('button', { name: 'Close preferences' })
    const last = screen.getByRole('button', { name: 'Clear board…' })

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
})

describe('the preferences store inside components', () => {
  function Probe() {
    const preferences = usePreferences()
    return <output>{`${preferences.theme}/${preferences.surface}/${preferences.yarnStyle}`}</output>
  }

  it('shows one value to every subscribed component and updates them together', () => {
    render(
      <>
        <Probe />
        <Probe />
      </>,
    )
    expect(screen.getAllByRole('status').map((node) => node.textContent)).toEqual([
      'dark/cork/minimal',
      'dark/cork/minimal',
    ])

    act(() => {
      setPreferences({ theme: 'light', surface: 'slate' })
    })

    expect(screen.getAllByRole('status').map((node) => node.textContent)).toEqual([
      'light/slate/minimal',
      'light/slate/minimal',
    ])
  })
})

describe('PreferencesPanel clearing the board', () => {
  it('only arms on the first confirmation, never clearing on one click', () => {
    const { onClearBoard } = panel()
    armClear()

    expect(onClearBoard).not.toHaveBeenCalled()
    // The armed control is gone, so a stray repeat click has nothing to hit;
    // the only destructive control now present is disabled.
    expect(screen.queryByRole('button', { name: 'Clear board…' })).toBeNull()
    expect(finalClearButton().disabled).toBe(true)
  })

  it('fires onClearBoard only after the word is typed and the final button pressed', () => {
    const { onClearBoard } = panel()
    armClear()

    fireEvent.change(typedConfirmation(), { target: { value: 'clearx' } })
    expect(finalClearButton().disabled).toBe(true)
    fireEvent.click(finalClearButton())
    expect(onClearBoard).not.toHaveBeenCalled()

    fireEvent.change(typedConfirmation(), { target: { value: 'clear' } })
    expect(finalClearButton().disabled).toBe(false)
    fireEvent.click(finalClearButton())

    expect(onClearBoard).toHaveBeenCalledTimes(1)
  })

  it('resets the confirmation when the first gate is cancelled', () => {
    panel()
    armClear()
    fireEvent.change(typedConfirmation(), { target: { value: 'clear' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // Back to the first gate with nothing remembered from the armed attempt.
    expect(screen.getByRole('button', { name: 'Clear board…' })).not.toBeNull()
    expect(screen.queryByLabelText(/type clear to confirm/i)).toBeNull()
  })

  it('does not touch the board when preferences are reset', () => {
    const { onClearBoard } = panel()
    fireEvent.click(screen.getByRole('button', { name: 'Reset preferences' }))

    expect(onClearBoard).not.toHaveBeenCalled()
    expect(getPreferences()).toEqual(DEFAULT_PREFERENCES)
  })

  it('cannot fire twice from one confirmation because it re-arms on success', () => {
    const { onClearBoard } = panel()
    armClear()
    fireEvent.change(typedConfirmation(), { target: { value: 'clear' } })
    fireEvent.click(finalClearButton())

    expect(onClearBoard).toHaveBeenCalledTimes(1)
    // Success drops back to the first gate, so a second firing needs the whole
    // two-step ritual again rather than another click on a live button.
    expect(screen.getByRole('button', { name: 'Clear board…' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: /^Clear board$/ })).toBeNull()
  })
})

describe('PreferencesPanel board files', () => {
  /**
   * A file input the picker would have filled in.
   *
   * Awaited, because the panel's load is a promise: the state it sets when the
   * board answers lands after the event handler has returned, and a change
   * outside `act` is a React warning rather than a failing assertion.
   */
  async function choose(input: HTMLElement, file: File): Promise<void> {
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => {
      fireEvent.change(input)
    })
  }

  it('will not load a file until the import has been armed', () => {
    // Loading a file replaces the board and there is no undo, so the button
    // asks first — the same two-step shape as clearing it.
    const { onImportBoard } = panel()

    expect(screen.queryByLabelText(/choose a board file/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Import board…' }))

    expect(screen.getByLabelText(/choose a board file/i)).not.toBeNull()
    expect(onImportBoard).not.toHaveBeenCalled()
  })

  it('hands the chosen file to the board', async () => {
    const { onImportBoard } = panel()
    fireEvent.click(screen.getByRole('button', { name: 'Import board…' }))

    const file = new File(['{}'], 'board.json', { type: 'application/json' })
    await choose(screen.getByLabelText(/choose a board file/i), file)

    expect(onImportBoard).toHaveBeenCalledWith(file)
  })

  it('shows why a file was refused, and stays armed to try another', async () => {
    // A refusal nobody can see is indistinguishable from a broken button.
    const onImportBoard = vi.fn(async () => 'That is JSON, but it is not a case board.')
    panel({ onImportBoard })
    fireEvent.click(screen.getByRole('button', { name: 'Import board…' }))
    await choose(screen.getByLabelText(/choose a board file/i), new File(['{}'], 'x.json'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('not a case board')
    expect(screen.getByLabelText(/choose a board file/i)).not.toBeNull()
  })

  it('arms down again once a file has loaded', async () => {
    panel({ onImportBoard: vi.fn(async () => null) })
    fireEvent.click(screen.getByRole('button', { name: 'Import board…' }))
    await choose(screen.getByLabelText(/choose a board file/i), new File(['{}'], 'x.json'))

    // The confirmation is spent, and the section is back to its resting state.
    expect(screen.queryByLabelText(/choose a board file/i)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('exports when asked, and exports nothing on its own', () => {
    const { onExportBoard } = panel()

    expect(onExportBoard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Export board…' }))

    expect(onExportBoard).toHaveBeenCalledTimes(1)
  })
})
