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
 */

import { useRef } from 'react'

import { MarkdownToolbar } from './MarkdownToolbar'
import { useTextareaFormat } from '../markdown/useTextareaFormat'

export interface PaperEditorProps {
  title: string
  value: string
  onChange: (next: string) => void
  onClose: () => void
}

export function PaperEditor({ title, value, onChange, onClose }: PaperEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const format = useTextareaFormat(textareaRef, value, onChange)

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

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="editor min-h-0 flex-1 resize-none rounded-b border border-t-0 border-parchment-edge/25 p-3 text-[13px]"
        aria-label="Article markdown source"
      />

      <p className="px-3 py-2 text-[10px] leading-relaxed text-board-ink-soft/45">
        Links between articles use <code className="font-mono">[[Double Brackets]]</code>. Click a
        word on the board to pin a note to it.
      </p>
    </aside>
  )
}
