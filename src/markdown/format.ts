/**
 * Markdown formatting actions for the editor toolbar.
 *
 * Every action is a pure function of (text, selection) → (text, selection),
 * which is what makes a formatting toolbar testable at all. The component is
 * then only responsible for reading the textarea's selection, calling this, and
 * writing the result back.
 *
 * Two behaviours make the difference between a toolbar that feels good and one
 * that fights you:
 *
 *   1. **They toggle.** Bold on already-bold text removes it. Without this, the
 *      second press produces `****text****` and you have to clean it up by hand,
 *      which is worse than having no button.
 *   2. **They keep the text selected.** After bolding, the words stay selected so
 *      you can immediately italicise them too. Collapsing the selection to the
 *      end means re-selecting by hand for every nested style.
 *
 * Line actions (headings, lists, quotes) work on every line the selection
 * touches, and toggle off only when *all* of those lines already carry the
 * prefix — otherwise a partially-listed block would un-list the lines that were
 * already correct instead of fixing the ones that weren't.
 */

export type MarkdownAction =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'link'
  | 'wikilink'
  | 'heading'
  | 'bullet'
  | 'ordered'
  | 'quote'

export interface EditResult {
  text: string
  selectionStart: number
  selectionEnd: number
}

/** Wrapping markers, for the actions that bracket a span. */
const WRAPPERS: Partial<Record<MarkdownAction, [string, string]>> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strikethrough: ['~~', '~~'],
  code: ['`', '`'],
  wikilink: ['[[', ']]'],
}

/** Placeholder inserted when an action is used with nothing selected. */
const PLACEHOLDERS: Partial<Record<MarkdownAction, string>> = {
  bold: 'bold text',
  italic: 'italic text',
  strikethrough: 'struck text',
  code: 'code',
  link: 'link text',
  wikilink: 'Article Title',
  heading: 'Heading',
  bullet: 'List item',
  ordered: 'List item',
  quote: 'Quoted text',
}

/** Line prefixes. `null` matches any leading list marker so toggling works on either. */
const LINE_PREFIXES: Partial<Record<MarkdownAction, RegExp>> = {
  heading: /^(#{1,6})\s/,
  bullet: /^[-*+]\s/,
  ordered: /^\d+\.\s/,
  quote: /^>\s?/,
}

/** What a line action inserts when the line doesn't already have it. */
function linePrefixFor(action: MarkdownAction, index: number): string {
  switch (action) {
    case 'heading':
      return '# '
    case 'bullet':
      return '- '
    case 'ordered':
      return `${index + 1}. `
    case 'quote':
      return '> '
    default:
      return ''
  }
}

/**
 * Apply a formatting action.
 *
 * `start` and `end` are the textarea's selection bounds; a reversed selection
 * (dragging right-to-left) is normalized rather than mishandled.
 */
export function applyMarkdownAction(
  text: string,
  start: number,
  end: number,
  action: MarkdownAction,
): EditResult {
  const from = Math.max(0, Math.min(Math.min(start, end), text.length))
  const to = Math.max(0, Math.min(Math.max(start, end), text.length))

  if (action in LINE_PREFIXES) return applyLineAction(text, from, to, action)
  if (action === 'link') return applyLink(text, from, to)

  const wrapper = WRAPPERS[action]
  if (!wrapper) return { text, selectionStart: from, selectionEnd: to }

  return applyWrapper(text, from, to, action, wrapper)
}

function applyWrapper(
  text: string,
  from: number,
  to: number,
  action: MarkdownAction,
  [open, close]: [string, string],
): EditResult {
  const selected = text.slice(from, to)

  // Nothing selected: insert a placeholder and select it, so the next keystroke
  // replaces it rather than landing awkwardly between the markers.
  if (from === to) {
    const placeholder = PLACEHOLDERS[action] ?? ''
    const inserted = `${open}${placeholder}${close}`
    return {
      text: text.slice(0, from) + inserted + text.slice(to),
      selectionStart: from + open.length,
      selectionEnd: from + open.length + placeholder.length,
    }
  }

  // Already wrapped, just inside the selection: strip the markers.
  const outerStart = from - open.length
  const outerEnd = to + close.length
  if (
    outerStart >= 0 &&
    text.slice(outerStart, from) === open &&
    text.slice(to, outerEnd) === close
  ) {
    return {
      text: text.slice(0, outerStart) + selected + text.slice(outerEnd),
      selectionStart: outerStart,
      selectionEnd: outerStart + selected.length,
    }
  }

  // Already wrapped, inside the selection: strip them from within.
  if (
    selected.length >= open.length + close.length &&
    selected.startsWith(open) &&
    selected.endsWith(close)
  ) {
    const inner = selected.slice(open.length, selected.length - close.length)
    return {
      text: text.slice(0, from) + inner + text.slice(to),
      selectionStart: from,
      selectionEnd: from + inner.length,
    }
  }

  return {
    text: text.slice(0, from) + open + selected + close + text.slice(to),
    selectionStart: from + open.length,
    selectionEnd: from + open.length + selected.length,
  }
}

function applyLink(text: string, from: number, to: number): EditResult {
  const selected = text.slice(from, to)
  const label = selected || PLACEHOLDERS.link!
  const url = 'url'

  // If the selection is already a markdown link, select its URL so the common
  // follow-up — pasting a real address — just works.
  const existing = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(selected)
  if (existing) {
    const urlStart = from + 1 + existing[1].length + 2
    return {
      text,
      selectionStart: urlStart,
      selectionEnd: urlStart + existing[2].length,
    }
  }

  const inserted = `[${label}](${url})`
  return {
    text: text.slice(0, from) + inserted + text.slice(to),
    // Select the URL, not the label: the label is usually right already and the
    // address is the part you have to go and fetch.
    selectionStart: from + 1 + label.length + 2,
    selectionEnd: from + 1 + label.length + 2 + url.length,
  }
}

function applyLineAction(
  text: string,
  from: number,
  to: number,
  action: MarkdownAction,
): EditResult {
  const pattern = LINE_PREFIXES[action]!

  // Expand to whole lines — a heading applies to the line, not to a character
  // range inside it.
  const lineStart = text.lastIndexOf('\n', Math.max(0, from - 1)) + 1
  const nextBreak = text.indexOf('\n', to)
  const lineEnd = nextBreak === -1 ? text.length : nextBreak

  const block = text.slice(lineStart, lineEnd)
  const lines = block.split('\n')

  // Which line the caret is on, so an empty line can still be acted on.
  const caretLine = block.slice(0, from - lineStart).split('\n').length - 1

  // Toggle off only when every line already has the prefix. A half-prefixed
  // block should be completed, not stripped. Blank lines are ignored rather than
  // counted as prefixed — counting them makes an all-blank block toggle the
  // wrong way and the button appear to do nothing.
  const meaningful = lines.filter((line) => line.trim() !== '')
  const allPrefixed = meaningful.length > 0 && meaningful.every((line) => pattern.test(line))

  const next = lines
    .map((line, index) => {
      if (allPrefixed) return line.replace(pattern, '')
      if (pattern.test(line)) return line

      if (line.trim() === '') {
        // A blank interior line stays blank — prefixing it leaves trailing
        // whitespace behind. The caret's own line is the exception: pressing
        // the button on an empty line should start the construct.
        if (index !== caretLine) return line
        return linePrefixFor(action, index) + (from === to ? (PLACEHOLDERS[action] ?? '') : '')
      }

      return linePrefixFor(action, index) + line
    })
    .join('\n')

  return {
    text: text.slice(0, lineStart) + next + text.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + next.length,
  }
}

/** The prefix a line carries, for the toolbar's active-state display. */
export function detectLinePrefix(line: string): MarkdownAction | null {
  for (const [action, pattern] of Object.entries(LINE_PREFIXES)) {
    if (pattern.test(line)) return action as MarkdownAction
  }
  return null
}

/** Whether the selection is currently wrapped by an action's markers. */
export function isWrapped(text: string, start: number, end: number, action: MarkdownAction): boolean {
  const wrapper = WRAPPERS[action]
  if (!wrapper) return false
  const [open, close] = wrapper

  if (start === end) {
    return (
      text.slice(Math.max(0, start - open.length), start) === open &&
      text.slice(end, end + close.length) === close
    )
  }

  return (
    (text.slice(Math.max(0, start - open.length), start) === open &&
      text.slice(end, end + close.length) === close) ||
    (text.slice(start, end + close.length).endsWith(close) &&
      text.slice(start, end).startsWith(open))
  )
}
