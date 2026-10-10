// The one thing on the board that asks before it goes. A page carries the pins
// anchored to its text, and each pin carries a note, so a page is a deletion that
// takes company — and an empty one never reaches this dialog at all.

import { useEffect, useRef } from "react";

import "./ConfirmDelete.css";

export interface ConfirmDeleteProps {
  title: string;
  body: string;
  onDelete: () => void;
  onCancel: () => void;
}

export function ConfirmDelete({
  title,
  body,
  onDelete,
  onCancel,
}: ConfirmDeleteProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // Caught before the board's own Escape, which would clear the selection.
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div
      className="delete-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Confirm delete"
        tabIndex={-1}
        className="delete-dialog"
        data-testid="entity-delete-ask"
      >
        <h2 className="delete-title">{title}</h2>
        <p className="delete-hint">{body}</p>
        <div className="delete-actions">
          <button
            type="button"
            className="delete-button"
            data-testid="entity-delete-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="delete-button delete-button-danger"
            data-testid="entity-delete-confirm"
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
