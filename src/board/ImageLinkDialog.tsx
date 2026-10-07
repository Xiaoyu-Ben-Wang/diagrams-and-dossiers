// A picture arrives as a file, a dropped link or a pasted one. This is the fourth
// way: typing the address, for a link that is easier to copy than to drag.

import { useEffect, useRef, useState } from "react";

import { isHttpImageSrc } from "../model/image-src";
import "./ImageLinkDialog.css";

export interface ImageLinkDialogProps {
  /** Resolves false when the address did not turn out to be a picture. */
  onAdd: (src: string) => Promise<boolean>;
  onClose: () => void;
}

export function ImageLinkDialog({ onAdd, onClose }: ImageLinkDialogProps) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // Stop it reaching the board, which reads Escape as "clear the selection".
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = src.trim();
    if (trimmed === "") return;
    if (!isHttpImageSrc(trimmed)) {
      setError("That has to be an http or https address.");
      return;
    }

    setBusy(true);
    const added = await onAdd(trimmed).finally(() => setBusy(false));
    if (added) onClose();
    else setError("Nothing loaded from that address.");
  };

  return (
    <div
      className="link-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="link-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add a picture from a link"
        data-testid="image-link-dialog"
        onSubmit={submit}
      >
        <h2 className="link-title">Add a picture from a link</h2>

        <label className="link-label" htmlFor="image-link">
          Image address
        </label>
        <input
          id="image-link"
          ref={inputRef}
          className="link-input"
          value={src}
          onChange={(event) => {
            setSrc(event.target.value);
            setError(null);
          }}
          placeholder="https://…"
          spellCheck={false}
          autoComplete="off"
        />

        <p className={error ? "link-hint link-hint-error" : "link-hint"}>
          {error ?? "The board keeps the address, not a copy of the picture."}
        </p>

        <div className="link-actions">
          <button type="button" className="link-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="link-button link-button-primary"
            data-testid="image-link-add"
            disabled={busy}
          >
            {busy ? "Loading…" : "Add picture"}
          </button>
        </div>
      </form>
    </div>
  );
}
