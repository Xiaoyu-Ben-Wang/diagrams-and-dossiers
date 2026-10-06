import { useEffect, useRef, useState } from "react";

import {
  SURFACES,
  resetPreferences,
  setPreferences,
  surfaceColor,
  usePreferences,
  type BoardSurface,
  type ThemeMode,
  type YarnStyle,
} from "./preferences";
import { POST_IT_COLORS } from "../board/tuning";
import { NOTE_FONT_LABELS } from "../model/kinds";
import {
  NOTE_FONTS,
  NOTE_STYLES,
  type NoteFont,
  type NoteStyle,
} from "../model/types";
import "./PreferencesPanel.css";

/** A swatch is a flat colour here, so each paper is approximated with a gradient. */
const PAPER_SWATCHES: Readonly<Record<NoteStyle, string>> = {
  plain: "var(--color-parchment-200)",
  ruled:
    "repeating-linear-gradient(to bottom, var(--color-parchment-200) 0 4px, color-mix(in srgb, var(--color-ink) 25%, transparent) 4px 5px)",
  grid: "repeating-linear-gradient(to bottom, var(--color-parchment-200) 0 4px, color-mix(in srgb, var(--color-ink) 18%, transparent) 4px 5px), repeating-linear-gradient(to right, var(--color-parchment-200) 0 4px, color-mix(in srgb, var(--color-ink) 18%, transparent) 4px 5px)",
  crumpled:
    "radial-gradient(circle at 30% 25%, color-mix(in srgb, var(--color-ink) 10%, transparent) 0 22%, transparent 55%), linear-gradient(135deg, var(--color-parchment-300) 0%, var(--color-parchment-100) 55%, var(--color-parchment-200) 100%)",
  taped:
    "linear-gradient(to bottom, rgb(255 255 255 / 0.75) 0 28%, var(--color-parchment-200) 28% 100%)",
};

const PAPER_OPTIONS: readonly ChoiceOption<NoteStyle>[] = NOTE_STYLES.map(
  (id) => ({
    value: id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    swatch: PAPER_SWATCHES[id],
  }),
);

const NOTE_COLOR_OPTIONS: readonly ChoiceOption<string>[] = POST_IT_COLORS.map(
  (entry) => ({
    value: entry.color,
    label: entry.name,
    swatch: entry.color,
  }),
);

const NOTE_FONT_OPTIONS: readonly ChoiceOption<NoteFont>[] = NOTE_FONTS.map(
  (id) => ({
    value: id,
    label: NOTE_FONT_LABELS[id],
    face: id,
  }),
);

/** Referenced by the trigger's aria-controls. */
export const PREFERENCES_PANEL_ID = "preferences-panel";

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  swatch?: string;
  /** Set in this face below the label, so the choice can be read rather than imagined. */
  face?: NoteFont;
}

/** Long enough to show a face's slope and spacing, short enough not to wrap. */
const FONT_SAMPLE = "The drowned bell";

const THEME_OPTIONS: readonly ChoiceOption<ThemeMode>[] = [
  { value: "dark", label: "Dark", hint: "Candlelit room" },
  { value: "light", label: "Light", hint: "Well-lit study" },
];

const YARN_OPTIONS: readonly ChoiceOption<YarnStyle>[] = [
  { value: "minimal", label: "Minimal" },
  { value: "realistic", label: "Dynamic" },
];

const SURFACE_LABELS: Record<BoardSurface, string | Record<ThemeMode, string>> =
  {
    // One surface, two rooms.
    cork: { light: "Cork", dark: "Dark leather" },
    felt: "Green felt",
    slate: "Slate",
    whiteboard: { light: "Whiteboard", dark: "Blackboard" },
  };

// Exported so the image export offers the board's surfaces by the names the panel uses;
// a second list of labels is a second list to drift.
export function surfaceLabel(surface: BoardSurface, theme: ThemeMode): string {
  const label = SURFACE_LABELS[surface];
  return typeof label === "string" ? label : label[theme];
}

// Native radios keep arrow-key navigation and group semantics for free.
function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="prefs-section">
      <legend className="prefs-legend">{legend}</legend>
      <div className="prefs-options">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className="prefs-option"
              data-selected={selected}
            >
              <input
                className="prefs-radio"
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
              />
              {option.swatch && (
                <span
                  className="prefs-swatch"
                  style={{ background: option.swatch }}
                  aria-hidden="true"
                />
              )}
              <span>
                <span className="prefs-option-label">{option.label}</span>
                {option.hint && (
                  <span className="prefs-option-hint">{option.hint}</span>
                )}
                {option.face && (
                  // The rule that styles a note is keyed on this attribute, so a
                  // sample written here is drawn by the same one the note uses.
                  <span
                    className="prefs-font-sample"
                    data-note-font={option.face}
                  >
                    {FONT_SAMPLE}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const CLEAR_WORD = "clear";

function DangerZone({ onClearBoard }: { onClearBoard: () => void }) {
  const [armed, setArmed] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation.trim().toLowerCase() === CLEAR_WORD;

  const cancel = () => {
    setArmed(false);
    setConfirmation("");
  };

  return (
    <section className="prefs-danger" aria-label="Danger zone">
      <h3 className="prefs-danger-title">Danger zone</h3>
      {armed ? (
        <>
          <p className="prefs-hint">
            This cannot be undone. Type <strong>{CLEAR_WORD}</strong> below to
            unlock the button.
          </p>
          <input
            className="prefs-confirm-input"
            type="text"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            aria-label={`Type ${CLEAR_WORD} to confirm clearing the board`}
            placeholder={CLEAR_WORD}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <div className="prefs-danger-actions">
            <button type="button" className="prefs-button" onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="prefs-button prefs-button-danger"
              disabled={!confirmed}
              onClick={() => {
                cancel();
                onClearBoard();
              }}
            >
              Clear board
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="prefs-hint">
            Clearing removes every pin, note and string. It cannot be undone.
          </p>
          <button
            type="button"
            className="prefs-button prefs-button-danger"
            onClick={() => setArmed(true)}
          >
            Clear board…
          </button>
        </>
      )}
    </section>
  );
}

function BoardFileSection({
  onExportBoard,
  onImportBoard,
  onExportImage,
}: {
  onExportBoard: () => void;
  onExportImage: () => void;
  onImportBoard: (file: File) => Promise<string | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [armed, setArmed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = (file: File | undefined): void => {
    if (!file) return;
    void onImportBoard(file).then((reason) => {
      setProblem(reason);
      if (!reason) setArmed(false);
      // Cleared so re-choosing the same file fires `change` again after a failed load.
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  return (
    <section className="prefs-section" aria-label="Board file">
      <h3 className="prefs-legend">Board file</h3>
      <p className="prefs-hint">
        A board file is JSON: every page, note, tack, picture and string.
      </p>
      <div className="prefs-danger-actions">
        <button type="button" className="prefs-button" onClick={onExportBoard}>
          Export board…
        </button>
        <button
          type="button"
          className="prefs-button"
          data-testid="export-image"
          onClick={onExportImage}
        >
          Export image…
        </button>
        <button
          type="button"
          className="prefs-button"
          onClick={() => {
            setProblem(null);
            setArmed(true);
          }}
          disabled={armed}
        >
          Import board…
        </button>
      </div>

      {armed ? (
        <div className="prefs-import">
          <p className="prefs-hint">
            Loading a file replaces everything on the board. It cannot be
            undone.
          </p>
          <input
            ref={inputRef}
            className="prefs-file-input"
            type="file"
            accept="application/json,.json"
            aria-label="Choose a board file to load"
            onChange={(event) => load(event.target.files?.[0])}
          />
          <button
            type="button"
            className="prefs-button"
            onClick={() => setArmed(false)}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {problem ? (
        <p className="prefs-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

export interface PreferencesPanelProps {
  open: boolean;
  onClose: () => void;
  onClearBoard: () => void;
  onExportBoard: () => void;
  onExportImage: () => void;
  /** Resolves to why it could not load, or null. */
  onImportBoard: (file: File) => Promise<string | null>;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function keepFocusInside(
  event: KeyboardEvent,
  container: HTMLElement | null,
): void {
  if (!container) return;
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE),
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;

  // Tab from the dialog container itself would otherwise step out of the drawer.
  if (document.activeElement === container) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function PreferencesPanel({
  open,
  onClose,
  onClearBoard,
  onExportBoard,
  onImportBoard,
  onExportImage,
}: PreferencesPanelProps) {
  const preferences = usePreferences();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // In a ref so an inline arrow cannot re-run the effect and re-focus mid-keystroke.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") keepFocusInside(event, panelRef.current);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Hands the keyboard back to the opening button rather than dropping it onto <body>.
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  // Unmounting resets the danger-zone confirmation; an armed "clear" must not survive.
  if (!open) return null;

  const surfaceOptions: readonly ChoiceOption<BoardSurface>[] = SURFACES.map(
    (surface) => ({
      value: surface,
      label: surfaceLabel(surface, preferences.theme),
      swatch: surfaceColor(surface, preferences.theme),
    }),
  );

  return (
    <div
      className="prefs-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        id={PREFERENCES_PANEL_ID}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
        tabIndex={-1}
        className="prefs-panel"
        data-testid="preferences-panel"
      >
        <header className="prefs-header">
          <h2 className="prefs-title">Preferences</h2>
          <button
            type="button"
            className="prefs-close"
            onClick={onClose}
            aria-label="Close preferences"
          >
            ×
          </button>
        </header>

        <div className="prefs-body">
          <ChoiceGroup
            legend="Theme"
            name="prefs-theme"
            value={preferences.theme}
            options={THEME_OPTIONS}
            onChange={(theme) => setPreferences({ theme })}
          />
          <ChoiceGroup
            legend="Board surface"
            name="prefs-surface"
            value={preferences.surface}
            options={surfaceOptions}
            onChange={(surface) => setPreferences({ surface })}
          />
          <ChoiceGroup
            legend="Yarn style"
            name="prefs-yarn"
            value={preferences.yarnStyle}
            options={YARN_OPTIONS}
            onChange={(yarnStyle) => setPreferences({ yarnStyle })}
          />

          <ChoiceGroup
            legend="New post-it paper"
            name="prefs-note-style"
            value={preferences.noteStyle}
            options={PAPER_OPTIONS}
            onChange={(noteStyle) => setPreferences({ noteStyle })}
          />
          <ChoiceGroup
            legend="New post-it colour"
            name="prefs-note-color"
            value={preferences.noteColor}
            options={NOTE_COLOR_OPTIONS}
            onChange={(noteColor) => setPreferences({ noteColor })}
          />
          <ChoiceGroup
            legend="New post-it writing"
            name="prefs-note-font"
            value={preferences.noteFont}
            options={NOTE_FONT_OPTIONS}
            onChange={(noteFont) => setPreferences({ noteFont })}
          />

          <div className="prefs-actions">
            <button
              type="button"
              className="prefs-button"
              onClick={() => resetPreferences()}
            >
              Reset preferences
            </button>
            <p className="prefs-hint">
              Puts theme, surface, yarn and the new-post-it trio back to their
              defaults. Your board is untouched.
            </p>
          </div>

          <BoardFileSection
            onExportBoard={onExportBoard}
            onImportBoard={onImportBoard}
            onExportImage={onExportImage}
          />

          <DangerZone onClearBoard={onClearBoard} />
        </div>
      </div>
    </div>
  );
}
