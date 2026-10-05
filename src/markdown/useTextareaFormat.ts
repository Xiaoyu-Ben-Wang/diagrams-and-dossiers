/**
 * Wires the formatting toolbar to a textarea.
 *
 * The fiddly part is restoring the selection. `applyMarkdownAction` returns the
 * selection the result *should* have — the bolded words stay selected so you can
 * italicise them next — but the textarea is a controlled React input, so setting
 * `.value` yourself is pointless: the next render overwrites it, and the caret
 * jumps to the end.
 *
 * So the target selection is parked in a ref and applied in a layout effect,
 * after React has committed the new value but before the browser paints. Doing
 * it in a `requestAnimationFrame` instead works most of the time and fails under
 * load, which is the worst kind of bug to chase.
 */

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

import { applyMarkdownAction, type EditResult, type MarkdownAction } from './format'

export function useTextareaFormat(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  onChange: (next: string) => void,
): {
  /** Run a toolbar action against whatever is selected. */
  format: (action: MarkdownAction) => void
  /**
   * Apply an edit computed elsewhere, and put the caret where it asks.
   *
   * The mention picker needs this: it knows the range it is replacing and what
   * it is replacing it with, and `applyMarkdownAction` has no way to express
   * that. Both paths share the pending-selection dance below, which is the part
   * that is easy to get wrong and was worth not writing twice.
   */
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
