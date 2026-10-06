// The title printed across a folded page. It shrinks to fit rather than being
// cut off, because the whole point of printing it is that the sheet can be told
// from the others on the board without opening it.

import { useLayoutEffect, useRef, useState } from "react";

import { FOLDER_LABEL_MAX, FOLDER_LABEL_MIN, FOLDER_LABEL_PAD } from "./tuning";

export interface FolderLabelProps {
  title: string;
}

export function FolderLabel({ title }: FolderLabelProps) {
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [size, setSize] = useState(FOLDER_LABEL_MAX);

  useLayoutEffect(() => {
    const label = labelRef.current;
    const ruler = measureRef.current;
    const fold = label?.parentElement;
    if (!label || !ruler || !fold) return;

    const fit = (): void => {
      const available = fold.clientWidth - FOLDER_LABEL_PAD * 2;
      // Zero in jsdom, which has no layout: the label then stays at the ceiling.
      if (available <= 0) return;
      const natural = ruler.scrollWidth;
      if (natural <= 0) return;
      const wanted = Math.floor((FOLDER_LABEL_MAX * available) / natural);
      setSize(Math.max(FOLDER_LABEL_MIN, Math.min(FOLDER_LABEL_MAX, wanted)));
    };

    fit();
    // A page can be dragged wider while it is folded; the print follows.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(fold);
    return () => observer.disconnect();
  }, [title]);

  return (
    <>
      <span
        ref={labelRef}
        className="paper-fold-title"
        style={{ fontSize: size }}
      >
        {title}
      </span>
      {/* The same title at the ceiling size, hidden and out of the flow, so the
          ratio the real one is sized by is of the untruncated text. Its font size
          is pinned here rather than left to inherit, or it would measure itself. */}
      <span
        ref={measureRef}
        aria-hidden="true"
        className="paper-fold-title paper-fold-title--measure"
        style={{ fontSize: FOLDER_LABEL_MAX }}
      >
        {title}
      </span>
    </>
  );
}
