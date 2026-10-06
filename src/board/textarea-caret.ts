// Not copied: they would move the mirror, or this function sets them itself.
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
  left: number
  top: number
  height: number
}

/** Null when the element has no box — unlaid-out panel, or jsdom's zero measurements. */
export function caretRect(textarea: HTMLTextAreaElement): CaretRect | null {
  const box = textarea.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return null

  const styles = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')

  mirror.setAttribute('aria-hidden', 'true')

  // `setProperty` takes kebab-case names and silently ignores anything else.
  for (let i = 0; i < styles.length; i++) {
    const property = styles.item(i)
    if (NOT_COPIED.has(property)) continue
    mirror.style.setProperty(property, styles.getPropertyValue(property))
  }

  // Height is released so the mirror grows to hold text the textarea is scrolled past.
  mirror.style.height = 'auto'
  // Released too: a clamped mirror measures a caret that has been wrapped by the clamp.
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

  // An empty span has no position to measure, so the marker holds a zero-width char.
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
    // Mirror-relative, moved to the textarea, then un-scrolled since the mirror shows from its top.
    left: box.left + (markerBox.left - mirrorBox.left) - textarea.scrollLeft,
    top: box.top + (markerBox.top - mirrorBox.top) - textarea.scrollTop,
    height: markerBox.height || (Number.isFinite(lineHeight) ? lineHeight : 16),
  }
}

export interface PopupBounds {
  width: number
  height: number
}

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
