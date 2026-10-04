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

import { applyMarkdownAction, type MarkdownAction } from './format'

export function useTextareaFormat(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  onChange: (next: string) => void,
): (action: MarkdownAction) => void {
  const pendingSelection = useRef<{ start: number; end: number } | null>(null)

  useLayoutEffect(() => {
    const element = textareaRef.current
    const pending = pendingSelection.current
    if (!element || !pending) return

    element.focus()
    element.setSelectionRange(pending.start, pending.end)
    pendingSelection.current = null
  })

  return useCallback(
    (action: MarkdownAction) => {
      const element = textareaRef.current
      if (!element) return

      const result = applyMarkdownAction(
        value,
        element.selectionStart,
        element.selectionEnd,
        action,
      )

      pendingSelection.current = { start: result.selectionStart, end: result.selectionEnd }
      onChange(result.text)
    },
    [textareaRef, value, onChange],
  )
}
