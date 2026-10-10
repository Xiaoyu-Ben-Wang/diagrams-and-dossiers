import { useEffect, useRef } from "react";

export interface PinEditorProps {
  /** The pin this is the editor for, so the board knows what a keypress in it is editing. */
  entityId: string;
  quote: string;
  status: "exact" | "repaired" | "orphaned";
  dateLabel: string;
  body: string;
  x: number;
  y: number;
  onChange: (body: string) => void;
  onDateChange: (dateLabel: string) => void;
  onDelete: () => void;
  onMove: () => void;
  onClose: () => void;
  /** Somebody else has it; still readable, just not writable. */
  locked?: boolean;
}

const WIDTH = 288;
const ESTIMATED_HEIGHT = 240;

/** Kept between the card and the edge of the window it is placed in, in screen px. */
const VIEWPORT_MARGIN = 12;

export function PinEditor({
  entityId,
  quote,
  status,
  dateLabel,
  body,
  x,
  y,
  onChange,
  onDateChange,
  onDelete,
  onMove,
  onClose,
  locked = false,
}: PinEditorProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    textareaRef.current?.focus();
    const length = textareaRef.current?.value.length ?? 0;
    textareaRef.current?.setSelectionRange(length, length);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!cardRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };

    // Deferred by a tick, or the very click that opened the editor closes it.
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown);
    }, 0);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - WIDTH - VIEWPORT_MARGIN);
  const top = Math.min(
    y,
    window.innerHeight - ESTIMATED_HEIGHT - VIEWPORT_MARGIN,
  );

  return (
    <div
      ref={cardRef}
      data-entity-id={entityId}
      className="fixed z-50 rounded-sm border border-border/50 bg-parchment-100 shadow-2xl"
      style={{
        left: Math.max(VIEWPORT_MARGIN, left),
        top: Math.max(VIEWPORT_MARGIN, top),
        width: WIDTH,
      }}
      role="dialog"
      aria-label="Edit pin"
      data-testid="pin-editor"
    >
      <header className="flex items-start justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] text-ink-soft italic">“{quote}”</p>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-soft/60">
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                background:
                  status === "orphaned"
                    ? "var(--color-danger)"
                    : status === "repaired"
                      ? "var(--color-warning)"
                      : "var(--color-accent)",
              }}
            />
            <input
              type="text"
              value={dateLabel}
              onChange={(event) => onDateChange(event.target.value)}
              placeholder="No date"
              aria-label="Pin date"
              title="The date on this pin's tag"
              className="min-w-0 flex-1 rounded-sm bg-parchment-200/50 px-1 py-0.5 text-[10px] text-ink-soft outline-none placeholder:text-ink-soft/35 hover:bg-parchment-200/80 focus:bg-parchment-200 focus:text-ink"
            />
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-soft/50 transition hover:text-ink"
          aria-label="Close"
        >
          ×
        </button>
      </header>

      <textarea
        ref={textareaRef}
        value={body}
        readOnly={locked}
        onChange={(event) => onChange(event.target.value)}
        placeholder={locked ? "" : "What do you know about this?"}
        rows={6}
        className="w-full resize-none bg-transparent px-3 py-2 text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-soft/40"
        aria-label={locked ? "Pin note (locked)" : "Pin note"}
      />

      <footer className="flex items-center justify-between border-t border-border/50 px-3 py-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onMove}
            className="text-[11px] text-ink-soft/70 transition hover:text-ink"
            title="Close this and drag the pin to reposition it"
          >
            Move pin
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-[11px] text-danger/80 transition hover:text-danger"
          >
            Remove pin
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-accent/60 bg-parchment-200 px-2.5 py-1 text-[11px] font-medium text-ink transition hover:bg-parchment-300"
        >
          Done
        </button>
      </footer>
    </div>
  );
}
