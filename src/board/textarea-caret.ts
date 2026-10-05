/**
 * Where the caret is in a `<textarea>`, in viewport coordinates.
 *
 * A textarea does not report this. `selectionStart` is a character offset and
 * there is no API that turns one into a rectangle — which is why the mention
 * list was first anchored to the editor panel instead, and why it appeared at
 * the top of the pane while you were typing at the bottom of it.
 *
 * The way round it is the old one: render the same text, in the same box, with
 * the same type, into a hidden element, put a zero-width marker where the caret
 * is, and measure the marker. It is exact only if the copy is exact, so the
 * styles that decide where a character lands are copied over — the font and its
 * spacing, the line height, the padding and border, the wrapping rules. A
 * mirror that disagrees with the textarea by one pixel of padding is a list
 * that sits one pixel off, and one that disagrees about wrapping puts the list
 * on the wrong line entirely.
 *
 * Measuring costs a layout and a style read, so this is called when the list is
 * open rather than on every render.
 */

/**
 * Properties not to copy: they would move the mirror, or they are the ones this
 * function sets itself. Everything else the browser reports is copied, which is
 * the point — see below.
 */
const NOT_COPIED = new Set([
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'float',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'display',
  'overflow-x',
  'overflow-y',
  'transform',
  'zoom',
  'visibility',
  'pointer-events',
])

export interface CaretRect {
  /** Left edge of the caret, in viewport px. */
  left: number
  /** Top of the line the caret is on. */
  top: number
  /** Height of that line, so a caller can hang something under it. */
  height: number
}

/**
 * The caret's rectangle, or null if it cannot be measured.
 *
 * Null rather than a guess when the element has no box — a panel that has not
 * been laid out yet, or the jsdom the tests run in, where every measurement is
 * zero. A caller with nowhere to point should fall back deliberately, not draw
 * at (0, 0).
 */
export function caretRect(textarea: HTMLTextAreaElement): CaretRect | null {
  const box = textarea.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return null

  const styles = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')

  mirror.setAttribute('aria-hidden', 'true')

  // Every property the browser reports, rather than a list written out here.
  //
  // The first version of this named the properties it thought mattered, in
  // camelCase, and passed them to `setProperty` — which takes kebab-case names
  // and ignores anything else without complaining. So the mirror got no font,
  // no line height and no padding, and measured the caret a line and a half
  // from where it was. A list also has the quieter failure of going stale: the
  // caret's position depends on `font-feature-settings` and `tab-size` as much
  // as on the font, and nobody remembers to add them. Copying the computed
  // style wholesale cannot be missing anything, and `NOT_COPIED` is short
  // enough to check.
  for (let i = 0; i < styles.length; i++) {
    const property = styles.item(i)
    if (NOT_COPIED.has(property)) continue
    mirror.style.setProperty(property, styles.getPropertyValue(property))
  }

  // `width` and `box-sizing` came over with the rest, so the mirror's content
  // box is the textarea's and the text wraps at the same words. Height is
  // released, because the mirror has to grow to hold text the textarea is
  // scrolled past.
  mirror.style.height = 'auto'
  // Released with it: a textarea sized by its parent may carry a min or max,
  // and a clamped mirror measures a caret that has been wrapped by the clamp.
  mirror.style.minHeight = '0'
  mirror.style.maxHeight = 'none'
  mirror.style.maxWidth = 'none'
  mirror.style.position = 'absolute'
  mirror.style.top = '0'
  mirror.style.left = '0'
  mirror.style.margin = '0'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.overflow = 'hidden'
  mirror.style.pointerEvents = 'none'

  // Everything before the caret, then a marker with something in it — an empty
  // span has no position to measure.
  mirror.textContent = textarea.value.slice(0, textarea.selectionStart)
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(marker)

  document.body.appendChild(mirror)
  const mirrorBox = mirror.getBoundingClientRect()
  const markerBox = marker.getBoundingClientRect()
  document.body.removeChild(mirror)

  const lineHeight = Number.parseFloat(styles.lineHeight)

  return {
    // Relative to the mirror, then moved to where the textarea is, then
    // un-scrolled: the mirror shows the text from its top, while the textarea
    // may have been scrolled down.
    left: box.left + (markerBox.left - mirrorBox.left) - textarea.scrollLeft,
    top: box.top + (markerBox.top - mirrorBox.top) - textarea.scrollTop,
    height: markerBox.height || (Number.isFinite(lineHeight) ? lineHeight : 16),
  }
}

/** A rectangle, in whatever space the caller is working in. */
export interface PopupBounds {
  width: number
  height: number
}

/**
 * Where a popup anchored to a caret goes, kept inside `bounds`.
 *
 * Below the caret, because that is where the writing is going and where the eye
 * already is — but flipped above when the caret is near the bottom of the box
 * and there is no room, which is precisely the case that produced this: an `@`
 * typed on the last line of a long document.
 *
 * All three arguments are in the same space, and the result is too. The caller
 * owns the conversion, because the caller is the one that knows what the popup
 * is positioned against — an offset parent for an absolutely-positioned list,
 * or the viewport for a portal. `clampMenuPosition` in `ContextMenu` solves the
 * same problem for a menu opened at a pointer; this differs in flipping rather
 * than only pushing, since a caret can legitimately be at the very bottom edge.
 */
export function placePopup(
  caret: { left: number; top: number; height: number },
  size: PopupBounds,
  bounds: PopupBounds,
  gap = 4,
  margin = 4,
): { left: number; top: number } {
  const lowest = bounds.height - size.height - margin
  const below = caret.top + caret.height + gap
  const above = caret.top - size.height - gap
  const top = below <= lowest ? below : Math.max(margin, Math.min(above, lowest))

  const rightmost = bounds.width - size.width - margin
  return {
    left: Math.round(Math.min(Math.max(caret.left, margin), Math.max(margin, rightmost))),
    top: Math.round(top),
  }
}
