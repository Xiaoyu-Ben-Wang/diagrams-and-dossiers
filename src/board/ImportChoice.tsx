// Asked where a file goes, rather than assumed. Importing used to overwrite the
// open board silently, which was survivable when nothing persisted and is not now.

import { useEffect, useRef } from "react";

import "./ImportChoice.css";

export interface ImportChoiceProps {
  fileName: string;
  onReplace: () => void;
  onAddBoard: () => void;
  onCancel: () => void;
}

export function ImportChoice({
  fileName,
  onReplace,
  onAddBoard,
  onCancel,
}: ImportChoiceProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div
      className="import-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Import a board"
        tabIndex={-1}
        className="import-dialog"
        data-testid="import-choice"
      >
        <h2 className="import-title">Import “{fileName}”</h2>
        <p className="import-hint">
          Replace the board you have open, or keep both and open the new one?
        </p>
        <div className="import-actions">
          <button
            type="button"
            className="import-button"
            data-testid="import-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="import-button"
            data-testid="import-replace"
            onClick={onReplace}
          >
            Replace this board
          </button>
          <button
            type="button"
            className="import-button import-button-primary"
            data-testid="import-add"
            onClick={onAddBoard}
          >
            Add as a new board
          </button>
        </div>
      </div>
    </div>
  );
}
