// Your boards, as a list. Everything shown per row is already in hand — a
// thumbnail would mean rendering the board here, which is the one thing a list of
// boards must not do.

import { useEffect, useRef, useState } from "react";
import { Link as LinkIcon, Pencil, Plus, Trash2, X } from "lucide-react";

import { TopBar } from "../app/TopBar";
import { ARTICLE_TITLE } from "../app/demo";
import { isSharedBoard, type BoardRecord } from "./board-record";
import type { BoardLibrary } from "./library";
import { copyTextToClipboard, shareUrlFor } from "./share";
import "./LibraryScreen.css";

export interface LibraryScreenProps {
  library: BoardLibrary;
  records: readonly BoardRecord[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onOpenDemo: () => void;
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
          className="library-new"
        >
          <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
          New board
        </button>
      </TopBar>

      <main
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-6"
        data-testid="library"
      >
        {library.degraded() ? (
          // Visible on purpose. Preferences fail quietly; a board is a session's work.
          <p
            className="library-warning"
            role="status"
            data-testid="library-degraded"
          >
            Changes aren’t being saved on this device. They will last until you
            close the tab.
          </p>
        ) : null}

        <DemoRow onOpen={onOpenDemo} />

        {records.length === 0 ? (
          <EmptyLibrary onCreate={onCreate} />
        ) : (
          <>
            <Group
              title="Your boards"
              records={records.filter((record) => !isSharedBoard(record))}
              library={library}
              onOpen={onOpen}
            />
            <Group
              title="Shared with you"
              records={records.filter(isSharedBoard)}
              library={library}
              onOpen={onOpen}
            />
          </>
        )}
      </main>
    </div>
  );
}

/**
 * Always first, and never one of the records: the demo is a look at a finished
 * board, so it has no name to change, no link to pass on and nothing to delete.
 */
function DemoRow({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="library-group">
      <h2 className="library-group-title">Demo</h2>
      <ul className="library-list" aria-label="Demo">
        <li className="library-board" data-testid="demo-board">
          <button
            type="button"
            className="library-name"
            onClick={onOpen}
            data-testid="open-demo"
          >
            {ARTICLE_TITLE}
          </button>
          <p className="library-meta">
            The demo board · nothing you do to it is kept
          </p>
        </li>
      </ul>
    </section>
  );
}

function EmptyLibrary({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="library-empty" data-testid="library-empty">
      <h1 className="library-empty-title">No boards yet</h1>
      <p className="library-empty-hint">
        A board is a page, some pictures, the pins holding them up, and the yarn
        between them.
      </p>
      <div className="library-empty-actions">
        <button
          type="button"
          className="library-button library-button-primary"
          onClick={onCreate}
        >
          New board
        </button>
      </div>
    </div>
  );
}

/** A heading and the boards under it. A group with nothing in it draws nothing. */
function Group({
  title,
  records,
  library,
  onOpen,
}: {
  title: string;
  records: readonly BoardRecord[];
  library: BoardLibrary;
  onOpen: (id: string) => void;
}) {
  if (records.length === 0) return null;

  return (
    <section className="library-group">
      <h2 className="library-group-title">{title}</h2>
      <ul className="library-list" aria-label={title}>
        {records.map((record) => (
          <BoardRow
            key={record.id}
            record={record}
            shared={isSharedBoard(record)}
            library={library}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
}

function BoardRow({
  record,
  shared,
  library,
  onOpen,
}: {
  record: BoardRecord;
  /** Somebody gave you a link to this one; you hold no link of your own to pass on. */
  shared: boolean;
  library: BoardLibrary;
  onOpen: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(record.name);
  const [armed, setArmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [localOnly, setLocalOnly] = useState(false);
  const [refused, setRefused] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) fieldRef.current?.select();
  }, [renaming]);

  const commitRename = (): void => {
    setRenaming(false);
    // A blank name would leave a row nobody can identify; the old one stays.
    if (draft.trim() !== "" && draft !== record.name)
      void library.rename(record.id, draft);
    else setDraft(record.name);
  };

  /**
   * Deleting is not forgetting. A board that is on the server goes there first,
   * and if that cannot happen nothing is removed here: a board gone from the list
   * but still on the server is the one thing nobody can put back.
   */
  const erase = async (): Promise<void> => {
    setArmed(false);
    setRefused(false);
    if (await library.destroy(record.id)) return;
    setRefused(true);
  };

  const share = async (): Promise<void> => {
    const url = shareUrlFor(record, window.location.origin);
    // A board that never reached the server has no token and so no door to offer.
    if (url === null) {
      setLocalOnly(true);
      return;
    }
    setLocalOnly(false);
    if (await copyTextToClipboard(url)) {
      setCopied(true);
      setManualLink(null);
      window.setTimeout(() => setCopied(false), 1500);
    } else {
      setManualLink(url);
    }
  };

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
            if (event.key === "Enter") commitRename();
            if (event.key === "Escape") {
              setDraft(record.name);
              setRenaming(false);
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
        {whenLabel(record.updatedAt)} · {record.board.entities.length} things ·{" "}
        {record.board.strings.length} strings
      </p>

      {armed ? (
        <div
          className="library-actions"
          role="group"
          aria-label={
            shared ? `Remove ${record.name}` : `Delete ${record.name}`
          }
        >
          <span className="library-confirm">
            {shared ? "Remove from this list?" : "Delete for good?"}
          </span>
          <button
            type="button"
            className="library-button"
            onClick={() => setArmed(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="library-button library-button-danger"
            data-testid={`confirm-delete-${record.id}`}
            onClick={() => void erase()}
          >
            {shared ? "Remove" : "Delete"}
          </button>
        </div>
      ) : (
        <div className="library-actions">
          <button
            type="button"
            className="library-button"
            onClick={() => {
              setDraft(record.name);
              setRenaming(true);
            }}
            aria-label={`Rename ${record.name}`}
            data-testid={`rename-${record.id}`}
          >
            <Pencil size={12} strokeWidth={2.2} aria-hidden="true" />
            Rename
          </button>
          {shared ? null : (
            <button
              type="button"
              className="library-button"
              onClick={() => void share()}
              aria-label={`Copy a link to ${record.name}`}
              data-testid={`share-${record.id}`}
            >
              <LinkIcon size={12} strokeWidth={2.2} aria-hidden="true" />
              {copied ? "Copied" : "Copy link"}
            </button>
          )}
          <button
            type="button"
            className="library-button"
            onClick={() => setArmed(true)}
            aria-label={
              shared
                ? `Remove ${record.name} from your list`
                : `Delete ${record.name}`
            }
            data-testid={`delete-${record.id}`}
          >
            {shared ? (
              <X size={12} strokeWidth={2.2} aria-hidden="true" />
            ) : (
              <Trash2 size={12} strokeWidth={2.2} aria-hidden="true" />
            )}
            {shared ? "Remove" : "Delete"}
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
          <span className="library-link-hint">
            Anyone with this link can edit the board.
          </span>
        </div>
      ) : null}

      {refused ? (
        <p
          className="library-link-hint"
          data-testid={`delete-failed-${record.id}`}
        >
          The server could not be told, so nothing was deleted — the board is
          still there, here and everywhere else.
        </p>
      ) : null}

      {shared ? (
        <p className="library-link-hint" data-testid={`from-link-${record.id}`}>
          You opened this from someone else's link. Anyone who has that link can
          edit the board.
        </p>
      ) : null}

      {localOnly ? (
        <p className="library-link-hint" data-testid={`local-${record.id}`}>
          No share link from this device. Either the board never reached the
          server, or you arrived by someone else's link and hold none of your
          own.
        </p>
      ) : null}
    </li>
  );
}

function whenLabel(from: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 45) return "just now";

  const step = (value: number, singular: string): string =>
    `${value} ${singular}${value === 1 ? "" : "s"} ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return step(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return step(hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 30) return step(days, "day");
  const months = Math.round(days / 30);
  if (months < 12) return step(months, "month");
  return step(Math.round(months / 12), "year");
}
