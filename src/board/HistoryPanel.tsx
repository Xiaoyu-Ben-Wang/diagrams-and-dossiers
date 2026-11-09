// The board's earlier versions, and putting one back.
//
// Restoring goes through `replaceAll`, so it is one undo step and reaches
// everyone else on the board like any other edit.

import { useEffect, useState } from "react";

import type { BoardState } from "./store";
import type { BoardHistory, SnapshotSummary } from "../history/types";
import { HOURLY_WINDOW_MS } from "../history/retention";
import "./ImageLinkDialog.css";
import "./HistoryPanel.css";

export interface HistoryPanelProps {
  history: BoardHistory;
  onRestore: (board: BoardState) => void;
  onClose: () => void;
  now?: number;
}

type Listing =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; snapshots: SnapshotSummary[] };

const TIME = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});
const DATE = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export function HistoryPanel({
  history,
  onRestore,
  onClose,
  now = Date.now(),
}: HistoryPanelProps) {
  const [listing, setListing] = useState<Listing>({ kind: "loading" });
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void history.list().then((snapshots) => {
      if (!live) return;
      setListing(
        snapshots === null ? { kind: "failed" } : { kind: "ready", snapshots },
      );
    });
    return () => {
      live = false;
    };
  }, [history]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // Stop it reaching the board, which reads Escape as "clear the selection".
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const restore = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    const board = await history.load(id).finally(() => setBusy(false));
    if (!board) {
      setError("That version could not be loaded.");
      return;
    }
    onRestore(board);
    onClose();
  };

  const recent =
    listing.kind === "ready"
      ? listing.snapshots.filter(
          (each) => now - each.takenAt <= HOURLY_WINDOW_MS,
        )
      : [];
  const older =
    listing.kind === "ready"
      ? listing.snapshots.filter(
          (each) => now - each.takenAt > HOURLY_WINDOW_MS,
        )
      : [];

  const row = (snapshot: SnapshotSummary, label: string) => (
    <li key={snapshot.id} className="history-row">
      <span className="history-when">{label}</span>
      <span className="history-meta">
        {snapshot.items} things · {snapshot.strings} strings
      </span>
      {armed === snapshot.id ? (
        <span className="history-confirm">
          <button
            type="button"
            className="link-button"
            onClick={() => setArmed(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="link-button link-button-primary"
            data-testid={`history-confirm-${snapshot.id}`}
            disabled={busy}
            onClick={() => void restore(snapshot.id)}
          >
            {busy ? "Restoring…" : "Restore"}
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="link-button"
          data-testid={`history-restore-${snapshot.id}`}
          aria-label={`Restore the version from ${label}`}
          onClick={() => setArmed(snapshot.id)}
        >
          Restore
        </button>
      )}
    </li>
  );

  return (
    <div
      className="link-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="link-dialog history-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Version history"
        data-testid="history-panel"
      >
        <h2 className="link-title">Version history</h2>

        {listing.kind === "loading" ? (
          <p className="link-hint">Loading…</p>
        ) : listing.kind === "failed" ? (
          <p className="link-hint link-hint-error">
            The history could not be loaded.
          </p>
        ) : listing.snapshots.length === 0 ? (
          <p className="link-hint" data-testid="history-empty">
            No versions yet. One is saved each hour the board changes.
          </p>
        ) : (
          <div className="history-scroll">
            {recent.length > 0 ? (
              <>
                <h3 className="link-label">Last 24 hours</h3>
                <ul className="history-list">
                  {recent.map((each) => row(each, TIME.format(each.takenAt)))}
                </ul>
              </>
            ) : null}
            {older.length > 0 ? (
              <>
                <h3 className="link-label">Daily</h3>
                <ul className="history-list">
                  {older.map((each) => row(each, DATE.format(each.takenAt)))}
                </ul>
              </>
            ) : null}
          </div>
        )}

        {error ? <p className="link-hint link-hint-error">{error}</p> : null}

        <div className="link-actions">
          <button type="button" className="link-button" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
