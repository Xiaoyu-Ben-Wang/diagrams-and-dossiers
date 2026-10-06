/**
 * `caretRangeFromPoint`'s two quirks: the engine prefix difference, and that it
 * hit-tests the real DOM, so anything floating over the text wins.
 */

/**
 * Chrome and Safari expose `caretRangeFromPoint`; Firefox exposes
 * `caretPositionFromPoint` and returns a node and offset. Normalised to a Range.
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

/** Hides the tacks for the measurement — a dragged pin sits under the cursor and
 * would otherwise win the hit-test. Synchronous, so nothing is painted between. */
export function caretRangeThroughPins(x: number, y: number): Range | null {
  const tacks = Array.from(document.querySelectorAll<HTMLElement>('[data-pin-id]'))
  for (const tack of tacks) tack.style.pointerEvents = 'none'
  try {
    return caretRangeFromPoint(x, y)
  } finally {
    for (const tack of tacks) tack.style.pointerEvents = ''
  }
}
