/**
 * The markdown editor that appears beside the board when a document is selected.
 *
 * It slides in rather than being permanently docked, because the board is the
 * point of the app and a permanently-open editor would eat a third of it for the
 * majority of the time you are not typing. Selecting a document is the signal
 * that you are about to write.
 *
 * The board keeps rendering the live preview underneath, so this is a split view
 * in effect — the paper on the board updates as you type, which is what makes
 * the pins visibly re-anchor rather than silently changing behind a panel.
 *
 * It also owns the mention list: type `@` and the things that have names appear.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { replaceRange } from '../markdown/format'
import { MarkdownToolbar } from './MarkdownToolbar'
import { caretRect, placePopup } from './textarea-caret'
import { useTextareaFormat } from '../markdown/useTextareaFormat'

/** Something a mention can name. */
export interface MentionCandidate {
  id: string
  name: string
  kind: 'article' | 'image'
}

export interface PaperEditorProps {
  title: string
  value: string
  onChange: (next: string) => void
  onClose: () => void
  /** Everything on the board that has a name, in board order. */
  mentions: readonly MentionCandidate[]
}

/** How many suggestions to show at once. A list longer than this is a scroll box nobody reads. */
const MAX_SUGGESTIONS = 8

const LIST_ID = 'mention-list'
const optionId = (index: number): string => `mention-option-${index}`

/**
 * The `@…` run the caret is sitting in, if it is sitting in one.
 *
 * Returns null unless there is an `@` behind the caret with nothing between them
 * but the query itself — no newline, no `]` from a mention already finished —
 * and unless that `@` is at a word boundary rather than inside one, which is the
 * same rule `parseMentions` applies when the article is rendered. The two have
 * to agree or the list would offer to complete something that will not linkify.
 */
function queryAt(
  text: string,
  caret: number,
): { from: number; to: number; query: string } | null {
  let index = caret - 1
  while (index >= 0) {
    const char = text[index]
    if (char === '@') break
    // A closing bracket or a line break ends the run: there is no completion to
    // offer for `@[Something]` already written, or for an `@` on another line.
    if (char === ']' || char === '\n') return null
    index--
  }
  if (index < 0) return null

  const before = index === 0 ? '' : text[index - 1]
  if (/[\p{L}\p{N}@]/u.test(before)) return null

  return { from: index, to: caret, query: text.slice(index + 1, caret) }
}

export function PaperEditor({
  title,
  value,
  onChange,
  onClose,
  mentions,
}: PaperEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const { format, apply } = useTextareaFormat(textareaRef, value, onChange)
  const [run, setRun] = useState<{ from: number; to: number; query: string } | null>(null)
  const [highlight, setHighlight] = useState(0)
  /** Where the list was put, in the pane's coordinates. Null until measured. */
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  /** Bumped by a scroll, which moves the caret without changing the value. */
  const [scrolled, setScrolled] = useState(0)

  const suggestions = useMemo(() => {
    if (!run) return []
    const query = run.query.trim().toLowerCase()
    const matches = query === ''
      ? mentions
      : mentions.filter((candidate) => candidate.name.toLowerCase().includes(query))
    return matches.slice(0, MAX_SUGGESTIONS)
  }, [run, mentions])

  const open = run !== null && suggestions.length > 0
  /** Kept in range as the list shrinks under the highlight. */
  const active = suggestions.length === 0 ? 0 : Math.min(highlight, suggestions.length - 1)

  // Put the list under the caret. A layout effect, so the first paint of the
  // list is already in the right place — anchored to the panel instead, it
  // appeared at the top of the pane while the typing was at the bottom of it,
  // which is nowhere near where you were looking.
  //
  // `suggestions` is a dependency even though the caret has not moved: a
  // different set of matches is a different height, and the flip-above decision
  // is made on that height.
  useLayoutEffect(() => {
    const list = listRef.current
    const area = textareaRef.current
    const pane = list?.offsetParent
    if (!list || !area || !(pane instanceof HTMLElement)) return

    const caret = caretRect(area)
    if (!caret) return

    const paneBox = pane.getBoundingClientRect()
    const next = placePopup(
      // Both the caret and the pane are in viewport px; the list is positioned
      // against the pane, so the pane's own corner comes off.
      { left: caret.left - paneBox.left, top: caret.top - paneBox.top, height: caret.height },
      { width: list.offsetWidth, height: list.offsetHeight },
      { width: paneBox.width, height: paneBox.height },
    )
    setAt((previous) =>
      previous && previous.left === next.left && previous.top === next.top ? previous : next,
    )
  }, [open, run, suggestions, value, scrolled])

  const close = (): void => {
    setRun(null)
    setHighlight(0)
  }

  const pick = (candidate: MentionCandidate): void => {
    if (!run) return
    apply(replaceRange(value, run.from, run.to, `@[${candidate.name}]`))
    close()
    // The pending-selection effect in `useTextareaFormat` puts the caret back.
    textareaRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // An IME mid-composition owns Enter and the arrows. Stepping into a
    // suggestion list while somebody is picking a kanji would be the worst kind
    // of helpful.
    if (!open || event.nativeEvent.isComposing) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setHighlight((current) => {
        const from = Math.min(current, suggestions.length - 1)
        return (from + delta + suggestions.length) % suggestions.length
      })
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      pick(suggestions[active])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      // Only the list closes; the panel's own Escape handling is the board's,
      // and swallowing it here would make Escape mean two things at once.
      event.stopPropagation()
      close()
    }
  }

  return (
    <aside
      className="flex w-[min(92vw,380px)] shrink-0 flex-col overflow-hidden border-r border-parchment-edge/15 bg-cork-900/45"
      aria-label="Document editor"
      data-testid="paper-editor"
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.14em] text-brass uppercase">Editing</p>
          <p className="truncate text-xs text-board-ink">{title}</p>
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
            // Held back until the measurement lands, which is in the same frame
            // — this only hides the unmeasured default position.
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
                // Without this the textarea blurs on the press and the selection
                // the insertion needs is gone by the time the click lands.
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => pick(candidate)}
              >
                <span className="mention-option-kind">{candidate.kind === 'image' ? 'Picture' : 'Page'}</span>
                <span className="truncate">{candidate.name}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setRun(queryAt(event.target.value, event.target.selectionStart))
            setHighlight(0)
          }}
          // Clicking elsewhere in the text moves the caret out of the run, and
          // the list should follow the caret rather than where it was.
          onSelect={(event) => {
            const element = event.currentTarget
            setRun(queryAt(element.value, element.selectionStart))
          }}
          onKeyDown={onKeyDown}
          // The caret moves with the scroll, so the list has to follow it.
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

      <p className="px-3 py-2 text-[10px] leading-relaxed text-board-ink-soft/45">
        Mention a page or a picture with{' '}
        <code className="font-mono">@[Name]</code>, or type{' '}
        <code className="font-mono">@</code> for the list. Click a word on the board to pin a note
        to it.
      </p>
    </aside>
  )
}
