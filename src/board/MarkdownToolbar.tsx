import type { MarkdownAction } from '../markdown/format'

export interface MarkdownToolbarProps {
  onAction: (action: MarkdownAction) => void
  disabled?: boolean
  className?: string
}

interface ToolButton {
  action: MarkdownAction
  label: string
  title: string
  className?: string
}

const TOOLS: Array<ToolButton | 'separator'> = [
  { action: 'bold', label: 'B', title: 'Bold — **text**', className: 'font-bold' },
  { action: 'italic', label: 'I', title: 'Italic — *text*', className: 'italic' },
  { action: 'strikethrough', label: 'S', title: 'Strikethrough — ~~text~~', className: 'line-through' },
  { action: 'code', label: '‹›', title: 'Inline code — `code`', className: 'font-mono' },
  'separator',
  { action: 'heading', label: 'H', title: 'Heading — # Heading' },
  { action: 'bullet', label: '•', title: 'Bulleted list' },
  { action: 'ordered', label: '1.', title: 'Numbered list' },
  { action: 'quote', label: '”', title: 'Block quote' },
  'separator',
  { action: 'link', label: 'Link', title: 'Link — [text](url)' },
]

export function MarkdownToolbar({ onAction, disabled = false, className }: MarkdownToolbarProps) {
  return (
    <div
      className={`flex flex-wrap items-center gap-0.5 rounded-t border border-b-0 border-parchment-edge/25 bg-cork-900/60 px-1 py-1 ${className ?? ''}`}
      role="toolbar"
      aria-label="Formatting"
      data-testid="markdown-toolbar"
    >
      {TOOLS.map((tool, index) =>
        tool === 'separator' ? (
          <span
            key={`sep-${index}`}
            className="mx-1 h-4 w-px bg-parchment-edge/25"
            aria-hidden="true"
          />
        ) : (
          <button
            key={tool.action}
            type="button"
            disabled={disabled}
            title={tool.title}
            aria-label={tool.title}
            // Without this the textarea loses focus and its selection with it.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onAction(tool.action)}
            className={`min-w-[26px] rounded px-1.5 py-0.5 text-[11px] text-board-ink-soft transition hover:bg-brass/25 hover:text-board-ink disabled:cursor-not-allowed disabled:opacity-40 ${tool.className ?? ''}`}
          >
            {tool.label}
          </button>
        ),
      )}
    </div>
  )
}
