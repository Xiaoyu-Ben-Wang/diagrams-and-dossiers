// In viewport space, like `EdgePicker`, and for the same reason: the world layer is a
// transformed stacking context, so a z-index inside it cannot rise above the palette.
//
// It stays open across a pick — both a paper and a colour are set before it is
// dismissed, which is why it is not a `ContextMenu`, whose model is activate-and-close.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { POST_IT_COLORS } from './tuning'
import { NOTE_STYLES, type NoteStyle } from '../model/types'
import { placeEdgePicker, type Box, type PickerPlacement } from './EdgePicker'

const STYLE_LABELS: Readonly<Record<NoteStyle, string>> = {
  plain: 'Plain',
  ruled: 'Ruled',
  grid: 'Grid',
  'dog-eared': 'Dog-eared',
  taped: 'Taped',
}

/** Wide enough to clear the pad it hangs off, which is 62px square. */
const MENU_GAP = 12
const MENU_MARGIN = 8

export interface NoteStyleMenuProps {
  /** The trigger, in client coordinates. */
  anchor: Box
  style: NoteStyle
  color: string
  onPickStyle: (style: NoteStyle) => void
  onPickColor: (color: string) => void
  onClose: () => void
}

export function NoteStyleMenu({
  anchor,
  style,
  color,
  onPickStyle,
  onPickColor,
  onClose,
}: NoteStyleMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<PickerPlacement | null>(null)

  useLayoutEffect(() => {
    const menu = menuRef.current
    const parent = menu?.offsetParent as HTMLElement | null
    if (!menu || !parent) return
    setPlacement(
      placeEdgePicker(
        anchor,
        { width: menu.offsetWidth, height: menu.offsetHeight },
        { width: parent.clientWidth, height: parent.clientHeight },
        MENU_GAP,
        MENU_MARGIN,
      ),
    )
  }, [anchor])

  // Focus goes in on open and back to whatever held it on close, as the context
  // menu does. The menu is not modal, so focus is not trapped.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    menuRef.current?.focus({ preventScroll: true })
    return () => {
      const active = document.activeElement
      const menuHeldFocus =
        active === null || active === document.body || menuRef.current?.contains(active) === true
      if (menuHeldFocus && previous && previous !== document.body && document.contains(previous)) {
        previous.focus({ preventScroll: true })
      }
    }
  }, [])

  // Kept in a ref so an inline arrow at the call site cannot re-register the
  // listeners on every render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dismiss = (): void => onCloseRef.current()

    // Capture phase: the board's own handlers stop propagation on the way up, so a
    // press on the cork would never reach a bubbling listener.
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Element | null
      if (menuRef.current?.contains(target as Node)) return
      // A press on the trigger toggles: dismissing here would close the menu and
      // then let the click reopen it.
      if (target?.closest?.('[data-note-style-menu-trigger]')) return
      dismiss()
    }
    const onScroll = (event: Event): void => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [])

  // Keys stop at the menu: the board behind it listens for Escape too.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    },
    [],
  )

  return (
    <div
      ref={menuRef}
      role="group"
      aria-label="Post-it paper and colour"
      data-testid="post-it-style-menu"
      data-side={placement?.side}
      className="note-style-menu absolute"
      tabIndex={-1}
      style={{
        left: placement?.left ?? anchor.left,
        top: placement?.top ?? anchor.top + anchor.height + MENU_GAP,
        visibility: placement ? 'visible' : 'hidden',
      }}
      // A press in the menu is not a press on the cork.
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <div className="note-style-group" role="group" aria-label="Paper">
        {NOTE_STYLES.map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`post-it-paper-${id}`}
            aria-pressed={id === style}
            data-selected={id === style}
            aria-label={STYLE_LABELS[id]}
            title={STYLE_LABELS[id]}
            className="note-style-paper"
            onClick={() => onPickStyle(id)}
          >
            <span
              aria-hidden="true"
              className="note-style-chip"
              data-note-style={id}
              // Painted in the note's current colour, so the pair can be judged together.
              style={{ backgroundColor: color }}
            />
          </button>
        ))}
      </div>

      <span className="note-style-split" aria-hidden="true" />

      <div className="note-style-group" role="group" aria-label="Colour">
        {POST_IT_COLORS.map((entry) => (
          <button
            key={entry.color}
            type="button"
            data-testid={`post-it-color-${entry.name.toLowerCase()}`}
            aria-pressed={entry.color === color}
            data-selected={entry.color === color}
            aria-label={`${entry.name} note`}
            title={entry.name}
            className="post-it-color"
            style={{ background: entry.color }}
            onClick={() => onPickColor(entry.color)}
          />
        ))}
      </div>
    </div>
  )
}
