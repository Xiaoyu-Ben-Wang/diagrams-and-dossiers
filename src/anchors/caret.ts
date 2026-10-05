/**
 * Asking the browser what word is under a point.
 *
 * `caretRangeFromPoint` is the only honest way to answer "which word is the
 * cursor over" — the alternative is hit-testing text nodes by hand, which means
 * re-deriving line boxes the browser already has. Its two quirks are what this
 * module exists to contain: it is prefixed differently across engines, and it
 * hit-tests the real DOM, so anything floating over the text wins the answer.
 */

/**
 * The caret position at a viewport point, in whichever engine is running.
 *
 * Chrome and Safari have `caretRangeFromPoint`; Firefox has
 * `caretPositionFromPoint` and returns a node and offset rather than a Range.
 * Both are normalised to a collapsed Range so callers have one thing to handle.
 */
export function caretRangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }

  if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y)

  const position = doc.caretPositionFromPoint?.(x, y)
  if (!position) return null
  const range = document.createRange()
  range.setStart(position.offsetNode, position.offset)
  range.collapse(true)
  return range
}

/**
 * The text under a screen point, ignoring any pin that happens to be there.
 *
 * During a pin drag the pin is underneath the cursor — the thing being dragged
 * is exactly the thing in the way — so the caret resolves inside the tack
 * rather than in the sentence it is being dragged over, and every drop reads as
 * "not on any text". This is what made re-pinning impossible to implement
 * without noticing: the answer was always "nowhere".
 *
 * The tacks are hidden for the duration of the measurement only. It is all
 * synchronous inside one event handler, so nothing is ever painted in between
 * and the trick is invisible.
 *
 * The inline style is cleared rather than restored to its old value, so the
 * `pointer-events-auto` class that normally applies to a tack takes over again
 * the moment this returns.
 */
export function caretRangeThroughPins(x: number, y: number): Range | null {
  const tacks = Array.from(document.querySelectorAll<HTMLElement>('[data-pin-id]'))
  for (const tack of tacks) tack.style.pointerEvents = 'none'
  try {
    return caretRangeFromPoint(x, y)
  } finally {
    for (const tack of tacks) tack.style.pointerEvents = ''
  }
}
