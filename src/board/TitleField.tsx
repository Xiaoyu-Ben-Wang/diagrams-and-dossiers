// A title, edited in place. Committed on blur rather than on every keystroke:
// a rename rewrites every mention of the old name across the whole board, so
// typing `Ann` would rewrite `@[A]`, then `@[An]`, then `@[Ann]` — three
// board-wide writes and three autosaves for one word.

import { useEffect, useRef, useState } from "react";

export interface TitleFieldProps {
  value: string;
  onCommit: (next: string) => void;
  /** Names the field for assistive tech, and is the only label it has. */
  label: string;
  placeholder: string;
  className?: string;
}

export function TitleField({
  value,
  onCommit,
  label,
  placeholder,
  className,
}: TitleFieldProps) {
  const [draft, setDraft] = useState(value);
  // A different entity selected under the same field starts from its own title.
  useEffect(() => setDraft(value), [value]);

  // Set on the way out of an Escape, so the blur it triggers does not commit the
  // text the key was pressed to abandon.
  const abandoned = useRef(false);

  const commit = (): void => {
    if (abandoned.current) {
      abandoned.current = false;
      return;
    }
    const next = draft.trim();
    if (next !== value.trim()) onCommit(next);
  };

  return (
    <input
      className={className}
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          abandoned.current = true;
          setDraft(value);
          event.currentTarget.blur();
        } else if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        // The board listens for keys too, and this is a text field.
        event.stopPropagation();
      }}
      // A press in a field is not a press on the board behind it.
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}
