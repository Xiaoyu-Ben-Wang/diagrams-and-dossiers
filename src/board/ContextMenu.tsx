/**
 * A right-click menu for the board.
 *
 * It renders through a portal onto `document.body` because the board viewport
 * has `overflow: hidden` — an in-tree menu would be clipped exactly at the
 * edges, which is where a right-click most often lands. Coordinates are
 * viewport pixels, matching the pointer coordinates that open it.
 *
 * The box is measured after mount and then clamped. Label lengths and font
 * metrics decide the real size, so a fixed-size guess would drift and a
 * bottom-right right-click would leave half a menu on screen.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

import './ContextMenu.css'

export interface ContextMenuItem {
  id: string
  label: string
  /** Right-aligned secondary text, e.g. a keyboard shortcut. */
  hint?: string
  /** Destructive actions get the wax seal's red. */
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export interface ContextMenuSeparator {
  id: string
  separator: true
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

export interface ContextMenuProps {
  /** Viewport coordinates of the pointer that opened the menu. */
  x: number
  y: number
  /** Items and separators, in render order. */
  items: ContextMenuEntry[]
  onClose: () => void
}

export interface Size {
  width: number
  height: number
}

/** Gap kept between the menu and every viewport edge. */
export const MENU_MARGIN = 8

export function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
  return 'separator' in entry
}

/** Ids that can hold the highlight, in render order. */
export function enabledIds(entries: ContextMenuEntry[]): string[] {
  const ids: string[] = []
  for (const entry of entries) {
    if (!isSeparator(entry) && !entry.disabled) ids.push(entry.id)
  }
  return ids
}

/**
 * The highlight `delta` steps from `currentId`, wrapping at the ends.
 *
 * `currentId === null` means nothing is highlighted yet, so stepping down
 * lands on the first item and stepping up on the last — which is how Home and
 * End reuse this instead of duplicating the walk. Disabled items are absent
 * from the sequence, so arrows pass straight over them.
 */
export function moveHighlight(
  entries: ContextMenuEntry[],
  currentId: string | null,
  delta: 1 | -1,
): string | null {
  const ids = enabledIds(entries)
  if (ids.length === 0) return null

  const current = currentId === null ? -1 : ids.indexOf(currentId)
  if (current === -1) return delta === 1 ? ids[0] : ids[ids.length - 1]
  return ids[(current + delta + ids.length) % ids.length]
}

/**
 * Where the menu's top-left corner should sit so the whole box stays visible.
 *
 * `max()` before `min()`: when the menu is larger than the viewport the margin
 * still wins, keeping the top-left corner — where every label starts — on
 * screen instead of pushing the box out past the near edge.
 */
export function clampMenuPosition(
  anchor: { x: number; y: number },
  size: Size,
  viewport: Size,
  margin = MENU_MARGIN,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewport.width - size.width - margin)
  const maxTop = Math.max(margin, viewport.height - size.height - margin)
  return {
    left: Math.round(Math.min(Math.max(anchor.x, margin), maxLeft)),
    top: Math.round(Math.min(Math.max(anchor.y, margin), maxTop)),
  }
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  // Namespaces the item ids so two menus in one document cannot collide.
  const baseId = useId()
  const [position, setPosition] = useState({ left: x, top: y })
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  // Read through a ref so the window/document listeners register once: a
  // parent that recreates onClose each render must not tear them down
  // mid-gesture, when the menu is about to close.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // Layout effect, so the correction lands in the same frame as the first
  // paint — no frame at the unclamped position. `items` is a dependency
  // because the labels decide the rendered height: a caller that swaps in
  // longer items while the menu is open would otherwise leave the clamp
  // measured against the old, smaller box and grow past the edge it was
  // pulled back from.
  useLayoutEffect(() => {
    const box = menuRef.current?.getBoundingClientRect()
    if (!box) return

    const next = clampMenuPosition(
      { x, y },
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    )
    setPosition((prev) => (prev.left === next.left && prev.top === next.top ? prev : next))
  }, [x, y, items])

  // The container is the single focus owner and the highlight is tracked with
  // `aria-activedescendant` rather than roving focus: the menu is short-lived,
  // so one focus owner avoids per-item tab stops and cannot get out of sync
  // with the DOM when items are disabled. Focus is restored on unmount so the
  // board keeps the keyboard.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    menuRef.current?.focus({ preventScroll: true })
    return () => {
      // Only take focus back if the menu still holds it (or a dismissal
      // dropped it on the body). If an item's action moved focus somewhere —
      // say, into the editor it just opened — that choice wins.
      const active = document.activeElement
      const menuHeldFocus =
        active === null || active === document.body || menuRef.current?.contains(active) === true
      if (menuHeldFocus && previous && previous !== document.body && document.contains(previous)) {
        previous.focus({ preventScroll: true })
      }
    }
  }, [])

  useEffect(() => {
    const dismiss = () => onCloseRef.current()
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss()
    }
    // Scroll does not bubble, so this is registered in the capture phase —
    // otherwise a scroll inside a pane on the board would go unseen. Scrolling
    // the menu itself is the one case that must not dismiss it.
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss()
    }

    // Capture phase: the board's own pointerdown handlers can stop
    // propagation on the way up, and a menu that misses a click on the cork
    // would sit open forever.
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [])

  function activate(item: ContextMenuItem): void {
    if (item.disabled) return
    item.onSelect()
    onClose()
  }

  // Handled keys stop at the menu: the board behind it also listens for Escape
  // and arrows, and one keypress must not act on both layers.
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        onClose()
        break
      case 'ArrowDown':
        event.preventDefault()
        event.stopPropagation()
        setHighlightedId((id) => moveHighlight(items, id, 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        event.stopPropagation()
        setHighlightedId((id) => moveHighlight(items, id, -1))
        break
      case 'Home':
        event.preventDefault()
        event.stopPropagation()
        setHighlightedId(moveHighlight(items, null, 1))
        break
      case 'End':
        event.preventDefault()
        event.stopPropagation()
        setHighlightedId(moveHighlight(items, null, -1))
        break
      case 'Enter': {
        event.preventDefault()
        event.stopPropagation()
        const item = items.find(
          (entry): entry is ContextMenuItem => !isSeparator(entry) && entry.id === highlightedId,
        )
        if (item) activate(item)
        break
      }
      default:
        break
    }
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
      aria-activedescendant={highlightedId === null ? undefined : `${baseId}${highlightedId}`}
      tabIndex={-1}
      className="context-menu"
      style={{ left: position.left, top: position.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((entry) =>
        isSeparator(entry) ? (
          <div key={entry.id} role="separator" className="context-menu__separator" />
        ) : (
          <button
            key={entry.id}
            id={`${baseId}${entry.id}`}
            type="button"
            role="menuitem"
            // aria-disabled rather than the disabled attribute: the item stays
            // discoverable as unavailable instead of vanishing from the menu.
            aria-disabled={entry.disabled === true ? true : undefined}
            tabIndex={-1}
            data-highlighted={highlightedId === entry.id ? 'true' : undefined}
            className={entry.danger ? 'context-menu__item context-menu__item--danger' : 'context-menu__item'}
            onClick={() => activate(entry)}
            onPointerEnter={() => {
              if (!entry.disabled) setHighlightedId(entry.id)
            }}
          >
            <span className="context-menu__label">{entry.label}</span>
            {entry.hint ? <span className="context-menu__hint">{entry.hint}</span> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
