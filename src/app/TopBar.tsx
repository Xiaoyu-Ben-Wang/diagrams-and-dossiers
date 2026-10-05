import { Settings } from 'lucide-react'

/**
 * The application chrome.
 *
 * The title, whatever controls the current page contributes, and preferences.
 * It held a nav when there were two pages to move between; with the board as the
 * only destination a single always-active tab was chrome with no function.
 */

export interface TopBarProps {
  onOpenPreferences: () => void
  /** Whether the preferences drawer is open, so the trigger can announce it. */
  preferencesOpen: boolean
  /** Id of the drawer this button controls. */
  preferencesPanelId: string
  /** Page-specific controls, rendered between the nav and the right-hand side. */
  children?: React.ReactNode
}

export function TopBar({
  onOpenPreferences,
  preferencesOpen,
  preferencesPanelId,
  children,
}: TopBarProps) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-parchment-edge/15 bg-cork-900/55 px-4 py-2 backdrop-blur-sm lg:px-6">
      <span className="text-sm font-semibold tracking-tight text-board-ink">
        The Case Board
      </span>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>

      <button
        type="button"
        onClick={onOpenPreferences}
        className="ml-auto flex shrink-0 items-center gap-1.5 rounded border border-parchment-edge/25 px-2.5 py-1 text-xs text-board-ink-soft transition hover:border-brass hover:text-board-ink"
        aria-label="Open preferences"
        // A drawer is a disclosure, so the trigger has to say whether it is
        // open and which region it controls. aria-label alone tells a screen
        // reader nothing about the state it just changed.
        aria-expanded={preferencesOpen}
        aria-controls={preferencesPanelId}
      >
        <Settings size={13} strokeWidth={2} aria-hidden="true" />
        Preferences
      </button>
    </header>
  )
}
