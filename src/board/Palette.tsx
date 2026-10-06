// The drag is tracked on the window, not by pointer capture on the pad: capture would aim
// every move event at the 60px pad while the pointer is somewhere else entirely.

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { NoteStyle } from "../model/types";
import { DRAG_THRESHOLD } from "./useBoardDrag";

export interface PalettePadProps {
  label: string;
  icon: ReactNode;
  ghost: (at: { x: number; y: number }) => ReactNode;
  onDrop: (clientX: number, clientY: number) => void;
  /** A press that never travelled. Given one, the pad opens a menu instead of doing nothing. */
  onOpen?: () => void;
  expanded?: boolean;
  disabled?: boolean;
  index?: number;
}

export function PalettePad({
  label,
  icon,
  ghost,
  onDrop,
  onOpen,
  expanded,
  disabled = false,
  index = 0,
}: PalettePadProps) {
  const [carrying, setCarrying] = useState<{ x: number; y: number } | null>(
    null,
  );
  const padRef = useRef<HTMLDivElement | null>(null);
  const carryingRef = useRef(false);
  /** The pointer that opened this press; a second finger is none of its business. */
  const pointerRef = useRef<number | null>(null);
  const lastRef = useRef({ x: 0, y: 0 });
  // A press that ends where it began is a click on the pad; without this a stray click leaves
  // a thing under the pad, which then swallows every press on that corner.
  const travelRef = useRef(0);

  const start = useCallback(
    (event: React.PointerEvent) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      carryingRef.current = true;
      pointerRef.current = event.pointerId;
      travelRef.current = 0;
      lastRef.current = { x: event.clientX, y: event.clientY };
      setCarrying({ x: event.clientX, y: event.clientY });
    },
    [disabled],
  );

  useEffect(() => {
    if (!carrying) return;

    const move = (event: PointerEvent): void => {
      if (!carryingRef.current || event.pointerId !== pointerRef.current)
        return;
      // Summed here rather than inside the state updater: React may run an updater
      // twice, and the second run would count the same step again.
      travelRef.current +=
        Math.abs(event.clientX - lastRef.current.x) +
        Math.abs(event.clientY - lastRef.current.y);
      lastRef.current = { x: event.clientX, y: event.clientY };
      setCarrying({ x: event.clientX, y: event.clientY });
    };

    const drop = (event: PointerEvent): void => {
      if (!carryingRef.current || event.pointerId !== pointerRef.current)
        return;
      carryingRef.current = false;
      pointerRef.current = null;
      const travelled = travelRef.current >= DRAG_THRESHOLD;
      setCarrying(null);

      // Released back over the pad: a click, however far the pointer wandered on
      // the way there. Dropping would bury a note under the pad, where it then
      // swallows every press on that corner.
      const pad = padRef.current?.getBoundingClientRect();
      const onPad =
        pad !== undefined &&
        event.clientX >= pad.left &&
        event.clientX <= pad.right &&
        event.clientY >= pad.top &&
        event.clientY <= pad.bottom;
      if (!travelled || onPad) {
        onOpen?.();
        return;
      }

      const box = document
        .querySelector('[data-testid="board-canvas"]')
        ?.getBoundingClientRect();
      if (!box) return;
      if (
        event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom
      ) {
        return;
      }
      onDrop(event.clientX, event.clientY);
    };

    const cancel = (): void => {
      carryingRef.current = false;
      pointerRef.current = null;
      setCarrying(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, [carrying, onDrop, onOpen]);

  return (
    <>
      <div
        ref={padRef}
        className={`palette-pad palette-pad-${index} ${disabled ? "is-disabled" : ""}`}
        data-testid={`palette-pad-${index}`}
        // Lets the menu tell a press on its own trigger from a press elsewhere, so
        // the pad toggles rather than closing and reopening.
        data-note-style-menu-trigger={onOpen ? "" : undefined}
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-disabled={disabled}
        aria-haspopup={onOpen ? "true" : undefined}
        aria-expanded={onOpen ? expanded : undefined}
        title={label}
        onPointerDown={start}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          // A pad with a menu does not drop anything from the keyboard: Enter is
          // the keyboard's click, and here a click opens the menu.
          if (onOpen) {
            onOpen();
            return;
          }
          const box = document
            .querySelector('[data-testid="board-canvas"]')
            ?.getBoundingClientRect();
          if (box) onDrop(box.left + box.width / 2, box.top + box.height / 2);
        }}
      >
        <span className="palette-pad-sheet" aria-hidden="true">
          {icon}
        </span>
        <span className="palette-pad-label">{label}</span>
      </div>

      {carrying ? ghost(carrying) : null}
    </>
  );
}

export interface BoardPaletteProps {
  onDropNote: (clientX: number, clientY: number) => void;
  onDropPin: (clientX: number, clientY: number) => void;
  /** Opens the note pad's style and colour menu. */
  onOpenNoteMenu?: () => void;
  noteMenuOpen?: boolean;
  /** What that menu will make, so the pad can show it. */
  noteStyle?: NoteStyle;
  noteColor?: string;
  canCreate: boolean;
}

export const BoardPalette = memo(function BoardPalette({
  onDropNote,
  onDropPin,
  onOpenNoteMenu,
  noteMenuOpen,
  noteStyle = "plain",
  noteColor,
  canCreate,
}: BoardPaletteProps) {
  return (
    <div className="palette" data-testid="board-palette">
      <PalettePad
        index={0}
        label="Drag onto the board to pin something"
        disabled={!canCreate}
        icon={<PinGlyph />}
        ghost={(at) => (
          <span
            className="palette-ghost-tack"
            style={{ left: at.x, top: at.y }}
          />
        )}
        onDrop={onDropPin}
      />
      <PalettePad
        index={1}
        label="Drag to make a post-it, or click to style"
        disabled={!canCreate}
        onOpen={onOpenNoteMenu}
        expanded={noteMenuOpen}
        icon={<NoteGlyph style={noteStyle} color={noteColor} />}
        ghost={(at) => (
          <span
            className="palette-ghost-note"
            style={{ left: at.x, top: at.y }}
          />
        )}
        onDrop={onDropNote}
      />
    </div>
  );
});

function PinGlyph() {
  return <span className="palette-glyph-tack" />;
}

function NoteGlyph({ style, color }: { style: NoteStyle; color?: string }) {
  return (
    <span
      className="palette-glyph-note"
      data-note-style={style}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
