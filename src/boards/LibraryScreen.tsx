// Your boards, as a list. Everything shown per row is already in hand — a
// thumbnail would mean rendering the board here, which is the one thing a list of
// boards must not do.

import { useEffect, useRef, useState } from 'react'
import { Link as LinkIcon, Pencil, Plus, Trash2 } from 'lucide-react'

import { TopBar } from '../app/TopBar'
import type { BoardRecord } from './board-record'
import type { BoardLibrary } from './library'
import { copyTextToClipboard, shareUrlFor } from './share'
import './LibraryScreen.css'

export interface LibraryScreenProps {
  library: BoardLibrary
  records: readonly BoardRecord[]
  onOpen: (id: string) => void
  onCreate: () => void
  onOpenDemo: () => void
}

export function LibraryScreen({
  library,
  records,
  onOpen,
  onCreate,
  onOpenDemo,
}: LibraryScreenProps) {
  return (
    <div className="app-shell flex h-screen flex-col overflow-hidden">
      <TopBar>
        <button
          type="button"
          onClick={onCreate}
          data-testid="new-board"
          className="flex items-center gap-1.5 rounded border border-parchment-edge/25 px-2.5 py-1 text-xs text-board-ink-soft transition hover:border-brass hover:text-board-ink"
        >
          <Plus size={13} strokeWidth={2.2} aria-hidden="true" />
          New board
        </button>
      </TopBar>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-6" data-testid="library">
        {library.degraded() ? (
          // Visible on purpose. Preferences fail quietly; a board is a session's work.
          <p className="library-warning" role="status" data-testid="library-degraded">
            Changes aren’t being saved on this device. They will last until you close the tab.
          </p>
        ) : null}

        {records.length === 0 ? (
          <EmptyLibrary onCreate={onCreate} onOpenDemo={onOpenDemo} />
        ) : (
          <ul className="library-list" aria-label="Your boards">
            {records.map((record) => (
              <BoardRow
                key={record.id}
                record={record}
                library={library}
                onOpen={onOpen}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function EmptyLibrary({ onCreate, onOpenDemo }: { onCreate: () => void; onOpenDemo: () => void }) {
  return (
    <div className="library-empty" data-testid="library-empty">
      <h1 className="library-empty-title">No boards yet</h1>
      <p className="library-empty-hint">
        A board is a page, some pictures, the pins holding them up, and the yarn between them.
      </p>
      <div className="library-empty-actions">
        <button type="button" className="library-button library-button-primary" onClick={onCreate}>
          New board
        </button>
        <button type="button" className="library-button" onClick={onOpenDemo} data-testid="open-demo">
          Open the demo board
        </button>
      </div>
    </div>
  )
}

function BoardRow({
  record,
  library,
  onOpen,
}: {
  record: BoardRecord
  library: BoardLibrary
  onOpen: (id: string) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(record.name)
  const [armed, setArmed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [manualLink, setManualLink] = useState<string | null>(null)
  const fieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) fieldRef.current?.select()
  }, [renaming])

  const commitRename = (): void => {
    setRenaming(false)
    // A blank name would leave a row nobody can identify; the old one stays.
    if (draft.trim() !== '' && draft !== record.name) void library.rename(record.id, draft)
    else setDraft(record.name)
  }

  const share = async (): Promise<void> => {
    const url = shareUrlFor(record, window.location.origin)
    if (await copyTextToClipboard(url)) {
      setCopied(true)
      setManualLink(null)
      window.setTimeout(() => setCopied(false), 1500)
    } else {
      setManualLink(url)
    }
  }

  return (
    <li className="library-board" data-testid={`board-${record.id}`}>
      {renaming ? (
        <input
          ref={fieldRef}
          className="library-rename"
          value={draft}
          aria-label={`New name for ${record.name}`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename()
            if (event.key === 'Escape') {
              setDraft(record.name)
              setRenaming(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="library-name"
          onClick={() => onOpen(record.id)}
          data-testid={`open-${record.id}`}
        >
          {record.name}
        </button>
      )}

      <p className="library-meta">
        {whenLabel(record.updatedAt)} · {record.board.entities.length} things ·{' '}
        {record.board.strings.length} strings
      </p>

      {armed ? (
        <div className="library-actions" role="group" aria-label={`Delete ${record.name}`}>
          <span className="library-confirm">Delete for good?</span>
          <button type="button" className="library-button" onClick={() => setArmed(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="library-button library-button-danger"
            data-testid={`confirm-delete-${record.id}`}
            onClick={() => void library.remove(record.id)}
          >
            Delete
          </button>
        </div>
      ) : (
        <div className="library-actions">
          <button
            type="button"
            className="library-button"
            onClick={() => {
              setDraft(record.name)
              setRenaming(true)
            }}
            aria-label={`Rename ${record.name}`}
            data-testid={`rename-${record.id}`}
          >
            <Pencil size={12} strokeWidth={2.2} aria-hidden="true" />
            Rename
          </button>
          <button
            type="button"
            className="library-button"
            onClick={() => void share()}
            aria-label={`Copy a link to ${record.name}`}
            data-testid={`share-${record.id}`}
          >
            <LinkIcon size={12} strokeWidth={2.2} aria-hidden="true" />
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button
            type="button"
            className="library-button"
            onClick={() => setArmed(true)}
            aria-label={`Delete ${record.name}`}
            data-testid={`delete-${record.id}`}
          >
            <Trash2 size={12} strokeWidth={2.2} aria-hidden="true" />
            Delete
          </button>
        </div>
      )}

      {manualLink ? (
        <div className="library-link">
          <input
            className="library-link-field"
            readOnly
            value={manualLink}
            aria-label="Link to this board"
            data-testid={`link-${record.id}`}
            onFocus={(event) => event.target.select()}
          />
          {/* Honest, because there is no service behind it yet. */}
          <span className="library-link-hint">Opens on this device only, for now.</span>
        </div>
      ) : null}
    </li>
  )
}

function whenLabel(from: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000))
  if (seconds < 45) return 'just now'

  const step = (value: number, singular: string): string =>
    `${value} ${singular}${value === 1 ? '' : 's'} ago`

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return step(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return step(hours, 'hour')
  const days = Math.round(hours / 24)
  if (days < 30) return step(days, 'day')
  const months = Math.round(days / 30)
  if (months < 12) return step(months, 'month')
  return step(Math.round(months / 12), 'year')
}
