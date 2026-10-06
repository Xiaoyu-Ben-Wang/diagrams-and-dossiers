/**
 * The image export's options, over a darkened board.
 *
 * Owns nothing but the choices: the board knows how to render itself and
 * whether the file can be copied, so this asks and reports. Refusing a render
 * comes back as a reason, the way `importBoard` does.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clipboard, Download, X } from "lucide-react";

import {
  DEFAULT_EXPORT_SCALE,
  EXPORT_SCALES,
  backgroundFor,
  exportBounds,
  imageFileName,
  planExport,
  type ExportBackground,
  type ExportFill,
  type ExportPattern,
} from "./export-image";
import { copyImageToClipboard, downloadBlob } from "./export-png";
import {
  SURFACES,
  surfaceColor,
  type BoardSurface,
  type ThemeMode,
} from "../theme/preferences";
import { surfaceLabel } from "../theme/PreferencesPanel";
import "./ExportImageDialog.css";
import type { Rect } from "./camera";
import type { BoardState } from "./store";

export interface ExportOptions extends ExportBackground {
  scale: number;
}

export interface ExportImageDialogProps {
  board: BoardState;
  /** Everything on the board, in board space. */
  rects: readonly Rect[];
  /** The surface the board is on now, so the dialog opens on it. */
  surface: BoardSurface;
  theme: ThemeMode;
  onRender: (options: ExportOptions) => Promise<Blob | string>;
  onClose: () => void;
}

const FILLS: readonly { id: ExportFill; label: string }[] = [
  { id: "white", label: "White" },
  { id: "black", label: "Black" },
  { id: "transparent", label: "Clear" },
];

const PATTERNS: readonly { id: ExportPattern; label: string }[] = [
  { id: "plain", label: "Plain" },
  { id: "dots", label: "Dots" },
];

/** How wide the preview is drawn, in output pixels. */
const PREVIEW_WIDTH = 300;

export function ExportImageDialog({
  board,
  rects,
  surface,
  theme,
  onRender,
  onClose,
}: ExportImageDialogProps) {
  const [background, setBackground] = useState<ExportBackground>({
    fill: "surface",
    surface,
    custom: "#c9a561",
    pattern: "plain",
  });
  const [scale, setScale] = useState<number>(DEFAULT_EXPORT_SCALE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previewUrl = useRef<string | null>(null);

  const plan = useMemo(() => planExport(rects, scale), [rects, scale]);
  const bounds = useMemo(() => exportBounds(rects), [rects]);
  const options: ExportOptions = { ...background, scale };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => previous?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // The board has its own Escape handling; an open dialog is what it means
      // first.
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // The preview is the real pipeline at a small scale rather than a mock, so it
  // cannot drift from what Download produces. Debounced, because a change to
  // the options is usually a run of them and each costs a whole render.
  useEffect(() => {
    if (!bounds) return;
    let live = true;
    const timer = setTimeout(() => {
      void onRender({
        ...options,
        scale: Math.min(1, PREVIEW_WIDTH / bounds.width),
      }).then((result) => {
        if (!live || typeof result === "string") return;
        // Outside a state updater: React may replay one, and each replay
        // would strand the URL it made.
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = URL.createObjectURL(result);
        setPreview(previewUrl.current);
      });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [background, bounds, onRender]);

  // The last URL is still displayed when the dialog closes, so it is not the
  // effect above that can revoke it.
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  /** Render once, and hand the blob to `then`. A string back is a failure. */
  const run = async (
    then: (blob: Blob) => Promise<void> | void,
  ): Promise<void> => {
    if (busy || !plan) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const result = await onRender(options);
      if (typeof result === "string") setError(result);
      else await then(result);
    } finally {
      setBusy(false);
    }
  };

  const download = (): Promise<void> =>
    run((blob) => downloadBlob(blob, imageFileName(board)));

  const copy = (): Promise<void> =>
    run(async (blob) => {
      if (await copyImageToClipboard(blob)) setCopied(true);
      else
        setError(
          "This browser would not take an image that size — download it instead.",
        );
    });

  const chooseSurface = (id: BoardSurface): void =>
    setBackground((current) => ({ ...current, fill: "surface", surface: id }));

  return (
    <div
      className="export-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Export the board as an image"
        tabIndex={-1}
      >
        <header className="export-head">
          <h2>Export image</h2>
          <button
            type="button"
            className="export-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={14} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </header>

        <div className="export-preview" data-testid="export-preview">
          {preview ? (
            <img src={preview} alt="A preview of the exported image" />
          ) : null}
        </div>

        <section className="export-section" aria-label="Background">
          <h3>Board</h3>
          <div className="export-swatches">
            {SURFACES.map((id) => (
              <button
                key={id}
                type="button"
                className="export-swatch"
                data-testid={`export-surface-${id}`}
                data-selected={
                  background.fill === "surface" && background.surface === id
                }
                aria-pressed={
                  background.fill === "surface" && background.surface === id
                }
                title={surfaceLabel(id, theme)}
                onClick={() => chooseSurface(id)}
              >
                <span
                  className="export-swatch-chip"
                  style={{ background: surfaceColor(id, theme) }}
                />
                <span className="export-swatch-label">
                  {surfaceLabel(id, theme)}
                </span>
              </button>
            ))}
          </div>

          <div className="export-swatches">
            {FILLS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className="export-swatch"
                data-testid={`export-fill-${id}`}
                data-selected={background.fill === id}
                aria-pressed={background.fill === id}
                title={label}
                onClick={() =>
                  setBackground((current) => ({ ...current, fill: id }))
                }
              >
                <span
                  className="export-swatch-chip"
                  data-transparent={id === "transparent"}
                  style={
                    id === "transparent"
                      ? undefined
                      : {
                          background:
                            backgroundFor({ ...background, fill: id }, theme) ??
                            "#ffffff",
                        }
                  }
                />
                <span className="export-swatch-label">{label}</span>
              </button>
            ))}

            <label
              className="export-swatch export-swatch-custom"
              data-selected={background.fill === "custom"}
              title="Custom colour"
            >
              <input
                type="color"
                aria-label="Custom background colour"
                value={background.custom}
                onChange={(event) =>
                  setBackground((current) => ({
                    ...current,
                    fill: "custom",
                    custom: event.target.value,
                  }))
                }
              />
              <span className="export-swatch-label">Custom</span>
            </label>
          </div>

          <div
            className="export-patterns"
            role="group"
            aria-label="Background pattern"
          >
            {PATTERNS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className="export-pattern"
                data-testid={`export-pattern-${id}`}
                data-selected={background.pattern === id}
                aria-pressed={background.pattern === id}
                onClick={() =>
                  setBackground((current) => ({ ...current, pattern: id }))
                }
              >
                {label}
              </button>
            ))}
          </div>

          {background.fill === "transparent" ? (
            <p className="export-note">
              Shadows stay in the file and read as grey on a white viewer, which
              is what a transparent export of a board with shadows looks like.
            </p>
          ) : null}
        </section>

        <section className="export-section" aria-label="Size">
          <h3>Size</h3>
          <div className="export-scales">
            {EXPORT_SCALES.map((value) => (
              <button
                key={value}
                type="button"
                className="export-scale"
                data-testid={`export-scale-${value}`}
                data-selected={scale === value}
                aria-pressed={scale === value}
                onClick={() => setScale(value)}
              >
                {value}×
              </button>
            ))}
          </div>
          <p className="export-size" data-testid="export-size">
            {plan
              ? `${plan.width} × ${plan.height} pixels`
              : "Nothing on the board to export yet."}
          </p>
          {plan?.clamped ? (
            <p className="export-note" data-testid="export-clamped">
              {scale}× is larger than this browser will draw. Exporting at{" "}
              {plan.scale.toFixed(2)}× instead.
            </p>
          ) : null}
        </section>

        {error ? (
          <p className="export-error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="export-actions">
          <button type="button" className="export-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="export-button"
            data-testid="export-copy"
            disabled={busy || !plan}
            onClick={() => void copy()}
          >
            {copied ? (
              <Check size={13} strokeWidth={2.5} aria-hidden="true" />
            ) : (
              <Clipboard size={13} strokeWidth={2.2} aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            className="export-button export-button-primary"
            data-testid="export-download"
            disabled={busy || !plan}
            onClick={() => void download()}
          >
            <Download size={13} strokeWidth={2.2} aria-hidden="true" />
            {busy ? "Rendering…" : "Download PNG"}
          </button>
        </footer>
      </div>
    </div>
  );
}
