import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import "./ContextMenu.css";

export interface ContextMenuItem {
  id: string;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ContextMenuSeparator {
  id: string;
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export interface Size {
  width: number;
  height: number;
}

export const MENU_MARGIN = 8;

export function isSeparator(
  entry: ContextMenuEntry,
): entry is ContextMenuSeparator {
  return "separator" in entry;
}

export function enabledIds(entries: ContextMenuEntry[]): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (!isSeparator(entry) && !entry.disabled) ids.push(entry.id);
  }
  return ids;
}

/**
 * `currentId === null` means nothing is highlighted yet; stepping down lands on the first
 * item and up on the last, which is how Home and End reuse this.
 */
export function moveHighlight(
  entries: ContextMenuEntry[],
  currentId: string | null,
  delta: 1 | -1,
): string | null {
  const ids = enabledIds(entries);
  if (ids.length === 0) return null;

  const current = currentId === null ? -1 : ids.indexOf(currentId);
  if (current === -1) return delta === 1 ? ids[0] : ids[ids.length - 1];
  return ids[(current + delta + ids.length) % ids.length];
}

/**
 * `max()` before `min()` so that when the menu is larger than the viewport the margin
 * still wins, keeping the top-left corner on screen instead of off the near edge.
 */
export function clampMenuPosition(
  anchor: { x: number; y: number },
  size: Size,
  viewport: Size,
  margin = MENU_MARGIN,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const maxTop = Math.max(margin, viewport.height - size.height - margin);
  return {
    left: Math.round(Math.min(Math.max(anchor.x, margin), maxLeft)),
    top: Math.round(Math.min(Math.max(anchor.y, margin), maxTop)),
  };
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const [position, setPosition] = useState({ left: x, top: y });
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Layout effect so the clamp lands in the same frame as the first paint; `items` is a
  // dep because the labels decide the rendered height.
  useLayoutEffect(() => {
    const box = menuRef.current?.getBoundingClientRect();
    if (!box) return;

    const next = clampMenuPosition(
      { x, y },
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPosition((prev) =>
      prev.left === next.left && prev.top === next.top ? prev : next,
    );
  }, [x, y, items]);

  // The highlight is tracked with `aria-activedescendant` rather than roving focus, so
  // the menu is one focus owner; focus is restored on unmount unless an item moved it.
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    menuRef.current?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      const menuHeldFocus =
        active === null ||
        active === document.body ||
        menuRef.current?.contains(active) === true;
      if (
        menuHeldFocus &&
        previous &&
        previous !== document.body &&
        document.contains(previous)
      ) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    const dismiss = () => onCloseRef.current();
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss();
    };
    // Scroll does not bubble, so register in the capture phase; scrolling the menu itself
    // is the one case that must not dismiss it.
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss();
    };

    // Capture phase: the board's own pointerdown handlers can stop propagation on the way
    // up, so a missed cork click would leave the menu open forever.
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
    };
  }, []);

  function activate(item: ContextMenuItem): void {
    if (item.disabled) return;
    item.onSelect();
    onClose();
  }

  // Handled keys stop at the menu: the board behind it also listens for Escape and arrows.
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        setHighlightedId((id) => moveHighlight(items, id, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        setHighlightedId((id) => moveHighlight(items, id, -1));
        break;
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        setHighlightedId(moveHighlight(items, null, 1));
        break;
      case "End":
        event.preventDefault();
        event.stopPropagation();
        setHighlightedId(moveHighlight(items, null, -1));
        break;
      case "Enter": {
        event.preventDefault();
        event.stopPropagation();
        const item = items.find(
          (entry): entry is ContextMenuItem =>
            !isSeparator(entry) && entry.id === highlightedId,
        );
        if (item) activate(item);
        break;
      }
      default:
        break;
    }
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
      aria-activedescendant={
        highlightedId === null ? undefined : `${baseId}${highlightedId}`
      }
      tabIndex={-1}
      className="context-menu"
      style={{ left: position.left, top: position.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((entry) =>
        isSeparator(entry) ? (
          <div
            key={entry.id}
            role="separator"
            className="context-menu__separator"
          />
        ) : (
          <button
            key={entry.id}
            id={`${baseId}${entry.id}`}
            type="button"
            role="menuitem"
            aria-disabled={entry.disabled === true ? true : undefined}
            tabIndex={-1}
            data-highlighted={highlightedId === entry.id ? "true" : undefined}
            className={
              entry.danger
                ? "context-menu__item context-menu__item--danger"
                : "context-menu__item"
            }
            onClick={() => activate(entry)}
            onPointerEnter={() => {
              if (!entry.disabled) setHighlightedId(entry.id);
            }}
          >
            <span className="context-menu__label">{entry.label}</span>
            {entry.hint ? (
              <span className="context-menu__hint">{entry.hint}</span>
            ) : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
