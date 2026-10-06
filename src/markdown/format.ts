export type MarkdownAction =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'link'
  | 'heading'
  | 'bullet'
  | 'ordered'
  | 'quote'

export interface EditResult {
  text: string
  selectionStart: number
  selectionEnd: number
}

export function replaceRange(
  text: string,
  from: number,
  to: number,
  insertion: string,
): EditResult {
  const [low, high] = from <= to ? [from, to] : [to, from]
  const start = Math.max(0, Math.min(low, text.length))
  const end = Math.max(start, Math.min(high, text.length))
  const caret = start + insertion.length
  return {
    text: text.slice(0, start) + insertion + text.slice(end),
    selectionStart: caret,
    selectionEnd: caret,
  }
}

const WRAPPERS: Partial<Record<MarkdownAction, [string, string]>> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strikethrough: ['~~', '~~'],
  code: ['`', '`'],
}

const PLACEHOLDERS: Partial<Record<MarkdownAction, string>> = {
  bold: 'bold text',
  italic: 'italic text',
  strikethrough: 'struck text',
  code: 'code',
  link: 'link text',
  heading: 'Heading',
  bullet: 'List item',
  ordered: 'List item',
  quote: 'Quoted text',
}

const LINE_PREFIXES: Partial<Record<MarkdownAction, RegExp>> = {
  heading: /^(#{1,6})\s/,
  bullet: /^[-*+]\s/,
  ordered: /^\d+\.\s/,
  quote: /^>\s?/,
}

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

  if (from === to) {
    const placeholder = PLACEHOLDERS[action] ?? ''
    const inserted = `${open}${placeholder}${close}`
    return {
      text: text.slice(0, from) + inserted + text.slice(to),
      selectionStart: from + open.length,
      selectionEnd: from + open.length + placeholder.length,
    }
  }

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

  const lineStart = text.lastIndexOf('\n', Math.max(0, from - 1)) + 1
  const nextBreak = text.indexOf('\n', to)
  const lineEnd = nextBreak === -1 ? text.length : nextBreak

  const block = text.slice(lineStart, lineEnd)
  const lines = block.split('\n')

  const caretLine = block.slice(0, from - lineStart).split('\n').length - 1

  // Toggle off only when every non-blank line is prefixed; blank lines must not
  // count, or an all-blank block toggles the wrong way.
  const meaningful = lines.filter((line) => line.trim() !== '')
  const allPrefixed = meaningful.length > 0 && meaningful.every((line) => pattern.test(line))

  const next = lines
    .map((line, index) => {
      if (allPrefixed) return line.replace(pattern, '')
      if (pattern.test(line)) return line

      if (line.trim() === '') {
        // A blank interior line stays blank to avoid trailing whitespace; the
        // caret's own line is the exception, so the construct can be started.
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

export function detectLinePrefix(line: string): MarkdownAction | null {
  for (const [action, pattern] of Object.entries(LINE_PREFIXES)) {
    if (pattern.test(line)) return action as MarkdownAction
  }
  return null
}

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
