import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { replaceRange } from "../markdown/format";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { TitleField } from "./TitleField";
import { caretRect, placePopup } from "./textarea-caret";
import { useTextareaFormat } from "../markdown/useTextareaFormat";

export interface MentionCandidate {
  id: string;
  name: string;
  kind: "article" | "image";
}

export interface PaperEditorProps {
  title: string;
  value: string;
  onChange: (next: string) => void;
  /** Committed when the title field is left, not on every keystroke. */
  onRename: (next: string) => void;
  onClose: () => void;
  mentions: readonly MentionCandidate[];
}

const MAX_SUGGESTIONS = 8;

const LIST_ID = "mention-list";
const optionId = (index: number): string => `mention-option-${index}`;

// The `@…` run under the caret; the word-boundary rule must match `parseMentions`, or the
// list offers a completion that will not linkify.
function queryAt(
  text: string,
  caret: number,
): { from: number; to: number; query: string } | null {
  let index = caret - 1;
  while (index >= 0) {
    const char = text[index];
    if (char === "@") break;
    if (char === "]" || char === "\n") return null;
    index--;
  }
  if (index < 0) return null;

  const before = index === 0 ? "" : text[index - 1];
  if (/[\p{L}\p{N}@]/u.test(before)) return null;

  return { from: index, to: caret, query: text.slice(index + 1, caret) };
}

export function PaperEditor({
  title,
  value,
  onChange,
  onRename,
  onClose,
  mentions,
}: PaperEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { format, apply } = useTextareaFormat(textareaRef, value, onChange);
  const [run, setRun] = useState<{
    from: number;
    to: number;
    query: string;
  } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  // Bumped by a scroll, which moves the caret without changing the value.
  const [scrolled, setScrolled] = useState(0);

  const suggestions = useMemo(() => {
    if (!run) return [];
    const query = run.query.trim().toLowerCase();
    const matches =
      query === ""
        ? mentions
        : mentions.filter((candidate) =>
            candidate.name.toLowerCase().includes(query),
          );
    return matches.slice(0, MAX_SUGGESTIONS);
  }, [run, mentions]);

  const open = run !== null && suggestions.length > 0;
  const active =
    suggestions.length === 0 ? 0 : Math.min(highlight, suggestions.length - 1);

  // Layout effect so the first paint is already placed; `suggestions` is a dep because a
  // different set of matches is a different height, which decides the flip-above.
  useLayoutEffect(() => {
    const list = listRef.current;
    const area = textareaRef.current;
    const pane = list?.offsetParent;
    if (!list || !area || !(pane instanceof HTMLElement)) return;

    const caret = caretRect(area);
    if (!caret) return;

    const paneBox = pane.getBoundingClientRect();
    const next = placePopup(
      // Caret and pane are both viewport px; subtract the pane's corner to position against it.
      {
        left: caret.left - paneBox.left,
        top: caret.top - paneBox.top,
        height: caret.height,
      },
      { width: list.offsetWidth, height: list.offsetHeight },
      { width: paneBox.width, height: paneBox.height },
    );
    setAt((previous) =>
      previous && previous.left === next.left && previous.top === next.top
        ? previous
        : next,
    );
  }, [open, run, suggestions, value, scrolled]);

  const close = (): void => {
    setRun(null);
    setHighlight(0);
  };

  const pick = (candidate: MentionCandidate): void => {
    if (!run) return;
    apply(replaceRange(value, run.from, run.to, `@[${candidate.name}]`));
    close();
    textareaRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // An IME mid-composition owns Enter and the arrows.
    if (!open || event.nativeEvent.isComposing) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => {
        const from = Math.min(current, suggestions.length - 1);
        return (from + delta + suggestions.length) % suggestions.length;
      });
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      pick(suggestions[active]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // Only the list closes: stopPropagation keeps the board's Escape from closing the panel too.
      event.stopPropagation();
      close();
    }
  };

  return (
    <aside
      // Over the board rather than beside it: a panel that took width from the
      // canvas would resize it, and the board would slide sideways the moment a
      // page was opened for editing. Taken out of the flow, nothing moves.
      // Above the palette (28) and opaque, so it covers the pad rather than letting
      // it ghost through; below the menus (30), which must not be hidden while open.
      className="absolute inset-y-0 left-0 z-[29] flex w-[min(92vw,380px)] flex-col overflow-hidden border-r border-parchment-edge/15 bg-cork-900 shadow-2xl"
      aria-label="Document editor"
      data-testid="paper-editor"
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] tracking-[0.14em] text-brass uppercase">
            Editing
          </p>
          <TitleField
            className="paper-editor-title w-full truncate text-xs text-board-ink"
            value={title}
            onCommit={onRename}
            label="Page title"
            placeholder="Untitled sheet"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded px-1.5 text-board-ink-soft/60 transition hover:text-board-ink"
          aria-label="Close editor"
          title="Close editor"
        >
          ×
        </button>
      </div>

      <div className="px-3">
        <MarkdownToolbar onAction={format} />
      </div>

      <div className="relative min-h-0 flex-1">
        {open ? (
          <ul
            ref={listRef}
            id={LIST_ID}
            role="listbox"
            aria-label="Mention"
            data-testid="mention-list"
            className="mention-list"
            style={at ? { left: at.left, top: at.top } : undefined}
            data-placed={at !== null}
          >
            {suggestions.map((candidate, index) => (
              <li
                key={candidate.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className="mention-option"
                data-selected={index === active}
                // Without this the textarea blurs on the press and the selection the
                // insertion needs is gone by the time the click lands.
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => pick(candidate)}
              >
                <span className="mention-option-kind">
                  {candidate.kind === "image" ? "Picture" : "Page"}
                </span>
                <span className="truncate">{candidate.name}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setRun(queryAt(event.target.value, event.target.selectionStart));
            setHighlight(0);
          }}
          onSelect={(event) => {
            const element = event.currentTarget;
            setRun(queryAt(element.value, element.selectionStart));
          }}
          onKeyDown={onKeyDown}
          onScroll={() => setScrolled((tick) => tick + 1)}
          onBlur={close}
          spellCheck={false}
          className="editor h-full min-h-0 w-full resize-none rounded-b border border-t-0 border-parchment-edge/25 p-3 text-[13px]"
          aria-label="Article markdown source"
          aria-expanded={open}
          aria-controls={open ? LIST_ID : undefined}
          aria-activedescendant={open ? optionId(active) : undefined}
          role="combobox"
          aria-autocomplete="list"
        />
      </div>

      <p className="px-3 py-2 text-xs leading-relaxed text-board-ink-soft/45">
        Mention a page or a picture with{" "}
        <code className="font-mono">@[Name]</code>, or type{" "}
        <code className="font-mono">@</code> for the list. Click a word on the
        board to pin a note to it.
      </p>
    </aside>
  );
}
