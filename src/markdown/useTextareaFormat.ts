/**
 * The textarea is a controlled input, so the target selection is parked in a ref
 * and applied in a layout effect, after React commits but before paint.
 */

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

import { applyMarkdownAction, type EditResult, type MarkdownAction } from './format'

export function useTextareaFormat(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  onChange: (next: string) => void,
): {
  format: (action: MarkdownAction) => void
  /** Apply an edit computed elsewhere (the mention picker) and set the caret it asks for. */
  apply: (result: EditResult) => void
} {
  const pendingSelection = useRef<{ start: number; end: number } | null>(null)

  useLayoutEffect(() => {
    const element = textareaRef.current
    const pending = pendingSelection.current
    if (!element || !pending) return

    element.focus()
    element.setSelectionRange(pending.start, pending.end)
    pendingSelection.current = null
  })

  const apply = useCallback(
    (result: EditResult) => {
      pendingSelection.current = { start: result.selectionStart, end: result.selectionEnd }
      onChange(result.text)
    },
    [onChange],
  )

  const format = useCallback(
    (action: MarkdownAction) => {
      const element = textareaRef.current
      if (!element) return

      apply(
        applyMarkdownAction(value, element.selectionStart, element.selectionEnd, action),
      )
    },
    [textareaRef, value, apply],
  )

  return { format, apply }
}
