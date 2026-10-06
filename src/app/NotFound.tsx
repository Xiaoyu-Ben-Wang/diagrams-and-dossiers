// Where an address that means nothing now lands. Before this it silently drew the
// board, so a mistyped or stale link looked like it had worked.

import { ArrowLeft } from 'lucide-react'

export interface NotFoundProps {
  path: string
  onHome: () => void
}

export function NotFound({ path, onHome }: NotFoundProps) {
  return (
    <div className="app-shell flex h-screen items-center justify-center p-6">
      <div
        className="not-found flex max-w-sm flex-col items-start gap-3 rounded border border-parchment-edge/30 bg-cork-900/55 px-5 py-4"
        data-testid="not-found"
      >
        <h1 className="text-sm font-semibold text-board-ink">Nothing lives here</h1>
        <p className="text-xs text-board-ink-soft">
          <code className="rounded bg-black/20 px-1 py-0.5">{path}</code> is not a board address.
        </p>
        <button
          type="button"
          onClick={onHome}
          className="flex items-center gap-1.5 rounded border border-parchment-edge/25 px-2.5 py-1 text-xs text-board-ink-soft transition hover:border-brass hover:text-board-ink"
        >
          <ArrowLeft size={13} strokeWidth={2.2} aria-hidden="true" />
          Go to your boards
        </button>
      </div>
    </div>
  )
}
