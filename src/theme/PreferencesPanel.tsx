/**
 * The preferences drawer.
 *
 * Slides in over the board's right edge and changes the room the board is read
 * in. It owns no board data: the one destructive control here asks twice and
 * then calls onClearBoard(), and only the board decides what that means.
 *
 * The trigger lives in the app chrome and owns `aria-expanded`, since only it
 * knows whether the drawer is showing; the drawer itself owns `aria-modal`,
 * Escape and focus, because it is the thing holding focus.
 */

import { useEffect, useRef, useState } from 'react'

import {
  SURFACES,
  resetPreferences,
  setPreferences,
  surfaceColor,
  usePreferences,
  type BoardSurface,
  type ThemeMode,
  type YarnStyle,
} from './preferences'
import './PreferencesPanel.css'

/** Referenced by the trigger's aria-controls. */
export const PREFERENCES_PANEL_ID = 'preferences-panel'

interface ChoiceOption<T extends string> {
  value: T
  label: string
  hint?: string
  swatch?: string
}

const THEME_OPTIONS: readonly ChoiceOption<ThemeMode>[] = [
  { value: 'dark', label: 'Dark', hint: 'Candlelit room' },
  { value: 'light', label: 'Light', hint: 'Well-lit study' },
]

const YARN_OPTIONS: readonly ChoiceOption<YarnStyle>[] = [
  { value: 'minimal', label: 'Minimal', hint: 'A clean line' },
  { value: 'realistic', label: 'Realistic', hint: 'Fibre, fuzz and noise' },
]

/**
 * A label, or one per theme where the surface is a different material in each.
 * The whiteboard is the only one: it is a whiteboard in the light and the
 * blackboard beside it in the dark.
 */
const SURFACE_LABELS: Record<BoardSurface, string | Record<ThemeMode, string>> = {
  cork: 'Cork',
  leather: 'Dark leather',
  felt: 'Green felt',
  slate: 'Slate',
  whiteboard: { light: 'Whiteboard', dark: 'Blackboard' },
}

function surfaceLabel(surface: BoardSurface, theme: ThemeMode): string {
  const label = SURFACE_LABELS[surface]
  return typeof label === 'string' ? label : label[theme]
}

/** Native radio inputs keep arrow-key navigation and the group semantics for free. */
function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string
  name: string
  value: T
  options: readonly ChoiceOption<T>[]
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="prefs-section">
      <legend className="prefs-legend">{legend}</legend>
      <div className="prefs-options">
        {options.map((option) => {
          const selected = option.value === value
          return (
            <label key={option.value} className="prefs-option" data-selected={selected}>
              <input
                className="prefs-radio"
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
              />
              {option.swatch && (
                <span className="prefs-swatch" style={{ background: option.swatch }} aria-hidden="true" />
              )}
              <span>
                <span className="prefs-option-label">{option.label}</span>
                {option.hint && <span className="prefs-option-hint">{option.hint}</span>}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

const CLEAR_WORD = 'clear'

/**
 * Two gates before anything destructive happens.
 *
 * The second gate is a typed word, not a timed reveal and not a second click:
 * a stray double-click lands on whichever control sits nearest the first, and
 * shortening a delay only narrows the window it can happen in. A word cannot
 * be typed by accident, and the final button stays disabled until it matches,
 * so the only route to onClearBoard() is deliberate.
 */
function DangerZone({ onClearBoard }: { onClearBoard: () => void }) {
  const [armed, setArmed] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const confirmed = confirmation.trim().toLowerCase() === CLEAR_WORD

  const cancel = () => {
    setArmed(false)
    setConfirmation('')
  }

  return (
    <section className="prefs-danger" aria-label="Danger zone">
      <h3 className="prefs-danger-title">Danger zone</h3>
      {armed ? (
        <>
          <p className="prefs-hint">
            This cannot be undone. Type <strong>{CLEAR_WORD}</strong> below to unlock the button.
          </p>
          <input
            className="prefs-confirm-input"
            type="text"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            aria-label={`Type ${CLEAR_WORD} to confirm clearing the board`}
            placeholder={CLEAR_WORD}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <div className="prefs-danger-actions">
            <button type="button" className="prefs-button" onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="prefs-button prefs-button-danger"
              disabled={!confirmed}
              onClick={() => {
                cancel()
                onClearBoard()
              }}
            >
              Clear board
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="prefs-hint">Clearing removes every pin, note and string. It cannot be undone.</p>
          <button type="button" className="prefs-button prefs-button-danger" onClick={() => setArmed(true)}>
            Clear board…
          </button>
        </>
      )}
    </section>
  )
}

export interface PreferencesPanelProps {
  open: boolean
  onClose: () => void
  /** Ask the board to wipe itself. The panel never clears anything directly. */
  onClearBoard: () => void
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function keepFocusInside(event: KeyboardEvent, container: HTMLElement | null): void {
  if (!container) return
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) return

  // Tab from the dialog container itself (which holds the initial focus) would
  // otherwise step straight out of the drawer.
  if (document.activeElement === container) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
    return
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

export function PreferencesPanel({ open, onClose, onClearBoard }: PreferencesPanelProps) {
  const preferences = usePreferences()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  // Kept in a ref so an inline arrow from the parent cannot re-run the effect
  // on every render — that would re-focus the drawer mid-keystroke.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key === 'Tab') keepFocusInside(event, panelRef.current)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // The drawer is opened from a button; closing hands the keyboard back
      // rather than dropping focus onto <body>.
      restoreFocusRef.current?.focus()
    }
  }, [open])

  // Unmounting on close resets the danger-zone confirmation with it: an armed
  // "clear" must never survive a visit to another panel.
  if (!open) return null

  const surfaceOptions: readonly ChoiceOption<BoardSurface>[] = SURFACES.map((surface) => ({
    value: surface,
    label: surfaceLabel(surface, preferences.theme),
    swatch: surfaceColor(surface, preferences.theme),
  }))

  return (
    <div
      className="prefs-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        id={PREFERENCES_PANEL_ID}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
        tabIndex={-1}
        className="prefs-panel"
        data-testid="preferences-panel"
      >
        <header className="prefs-header">
          <h2 className="prefs-title">Preferences</h2>
          <button type="button" className="prefs-close" onClick={onClose} aria-label="Close preferences">
            ×
          </button>
        </header>

        <div className="prefs-body">
          <ChoiceGroup
            legend="Theme"
            name="prefs-theme"
            value={preferences.theme}
            options={THEME_OPTIONS}
            onChange={(theme) => setPreferences({ theme })}
          />
          <ChoiceGroup
            legend="Board surface"
            name="prefs-surface"
            value={preferences.surface}
            options={surfaceOptions}
            onChange={(surface) => setPreferences({ surface })}
          />
          <ChoiceGroup
            legend="Yarn style"
            name="prefs-yarn"
            value={preferences.yarnStyle}
            options={YARN_OPTIONS}
            onChange={(yarnStyle) => setPreferences({ yarnStyle })}
          />

          <div className="prefs-actions">
            <button type="button" className="prefs-button" onClick={() => resetPreferences()}>
              Reset preferences
            </button>
            <p className="prefs-hint">Puts theme, surface and yarn back to their defaults. Your board is untouched.</p>
          </div>

          <DangerZone onClearBoard={onClearBoard} />
        </div>
      </div>
    </div>
  )
}
