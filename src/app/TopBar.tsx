import { Settings } from 'lucide-react'

export interface TopBarProps {
  /** Left out where there is no panel to open, which is everywhere but the board. */
  onOpenPreferences?: () => void
  preferencesOpen?: boolean
  preferencesPanelId?: string
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
        Diagrams &amp; Dossiers
      </span>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>

      {onOpenPreferences ? (
        <button
        type="button"
        onClick={onOpenPreferences}
        className="ml-auto flex shrink-0 items-center gap-1.5 rounded border border-parchment-edge/25 px-2.5 py-1 text-[13px] text-board-ink-soft transition hover:border-brass hover:text-board-ink"
        aria-label="Open preferences"
        // A disclosure trigger must report its open state and controlled region.
        aria-expanded={preferencesOpen}
        aria-controls={preferencesPanelId}
      >
        <Settings size={13} strokeWidth={2} aria-hidden="true" />
        Preferences
        </button>
      ) : null}
    </header>
  )
}
