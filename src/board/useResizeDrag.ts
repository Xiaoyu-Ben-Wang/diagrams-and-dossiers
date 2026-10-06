import { useCallback, useRef } from "react";

import type { Point } from "./yarn";

export interface Size {
  width: number;
  height: number;
}

export interface ResizeDragOptions {
  /** Recorded at the press and computed from after; never accumulated. */
  size: Size;
  toBoard: (clientX: number, clientY: number) => Point;
  sizeAt: (pointer: Point, start: Size) => Size;
  onResize: (size: Size) => void;
}

export interface ResizeDragHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
}

export function useResizeDrag({
  size,
  toBoard,
  sizeAt,
  onResize,
}: ResizeDragOptions): ResizeDragHandlers {
  const startRef = useRef<Size | null>(null);

  const sizeRef = useRef(size);
  sizeRef.current = size;
  const toBoardRef = useRef(toBoard);
  toBoardRef.current = toBoard;
  const sizeAtRef = useRef(sizeAt);
  sizeAtRef.current = sizeAt;
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    // Must not select what is behind the handle, nor start a drag on the resized thing.
    event.stopPropagation();
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a refinement; the drag still tracks while over the handle.
    }

    // From the caller, not the DOM: a rotated element's client rect is the box around the turned shape.
    startRef.current = { ...sizeRef.current };
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const start = startRef.current;
    if (!start) return;
    event.stopPropagation();
    onResizeRef.current(
      sizeAtRef.current(
        toBoardRef.current(event.clientX, event.clientY),
        start,
      ),
    );
  }, []);

  const release = useCallback((event: React.PointerEvent) => {
    startRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: release,
    onPointerCancel: release,
  };
}
