/**
 * The application chrome.
 *
 * Board and Wiki are real links, not buttons that toggle a mode. They change the
 * URL, so the back button works, a wiki page can be bookmarked, and reloading
 * puts you back where you were. A "view" toggle that only sets state breaks all
 * three, and the failure is invisible until someone tries to share a link.
 *
 * Rendered as an `<a href>` rather than a click handler on purpose: middle-click
 * and cmd-click open a new tab for free, and the URL is visible on hover.
 */

import type { Route } from './router'
import { routeToPath } from './router'

export interface TopBarProps {
  route: Route
  navigate: (to: Route | string) => void
  onOpenPreferences: () => void
  /** Whether the preferences drawer is open, so the trigger can announce it. */
  preferencesOpen: boolean
  /** Id of the drawer this button controls. */
  preferencesPanelId: string
  /** Page-specific controls, rendered between the nav and the right-hand side. */
  children?: React.ReactNode
}

export function TopBar({
  route,
  navigate,
  onOpenPreferences,
  preferencesOpen,
  preferencesPanelId,
  children,
}: TopBarProps) {
  const onWiki = route.name === 'wiki'

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-parchment-edge/15 bg-cork-900/55 px-4 py-2 backdrop-blur-sm lg:px-6">
      <span className="text-sm font-semibold tracking-tight text-board-ink">
        The Case Board
      </span>

      <nav className="flex items-center gap-0.5" aria-label="Primary">
        {(
          [
            { name: 'board', label: 'Board' },
            { name: 'wiki', label: 'Wiki' },
          ] as const
        ).map((tab) => {
          const active = tab.name === 'wiki' ? onWiki : !onWiki && route.name !== 'notFound'
          const href = routeToPath(tab.name === 'wiki' ? { name: 'wiki', slug: null } : { name: 'board' })

          return (
            <a
              key={tab.name}
              href={href}
              aria-current={active ? 'page' : undefined}
              onClick={(event) => {
                // Let the browser handle modified clicks — new tab, new window,
                // download. Only plain left-clicks are ours.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                if (event.button !== 0) return
                event.preventDefault()
                navigate(tab.name === 'wiki' ? { name: 'wiki', slug: null } : { name: 'board' })
              }}
              className={`rounded px-2.5 py-1 text-xs transition ${
                active
                  ? 'bg-brass/25 text-board-ink'
                  : 'text-board-ink-soft hover:bg-cork-700/70 hover:text-board-ink'
              }`}
            >
              {tab.label}
            </a>
          )
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>

      <button
        type="button"
        onClick={onOpenPreferences}
        className="ml-auto shrink-0 rounded border border-parchment-edge/25 px-2.5 py-1 text-xs text-board-ink-soft transition hover:border-brass hover:text-board-ink"
        aria-label="Open preferences"
        // A drawer is a disclosure, so the trigger has to say whether it is
        // open and which region it controls. aria-label alone tells a screen
        // reader nothing about the state it just changed.
        aria-expanded={preferencesOpen}
        aria-controls={preferencesPanelId}
      >
        Preferences
      </button>
    </header>
  )
}
