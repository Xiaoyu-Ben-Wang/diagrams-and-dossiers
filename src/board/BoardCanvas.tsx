import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Focus } from "lucide-react";

import {
  fitBounds,
  panBy,
  rectFromPoints,
  zoomAt,
  type Camera,
  type Rect,
  type Viewport,
} from "./camera";
import { CLICK_SLOP, DRAG_THRESHOLD } from "./useBoardDrag";
import type { Point } from "./yarn";

export interface BoardContextTarget {
  clientX: number;
  clientY: number;
  target: EventTarget | null;
}

export interface BoardCanvasProps {
  camera: Camera;
  onCameraChange: (next: Camera) => void;
  children: ReactNode;
  className?: string;
  onContextTarget?: (target: BoardContextTarget) => void;
  onFileDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  onFileDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  fitTo?: Rect[];
  /** Sends the camera back to the whole board. Left out, and the control is not drawn. */
  onRecentre?: () => void;
  overlay?: ReactNode;
  backdrop?: (viewport: Viewport) => ReactNode;
  onViewportChange?: (viewport: Viewport) => void;
  onBackgroundClick?: (click: {
    point: Point;
    ctrlKey: boolean;
    metaKey: boolean;
  }) => void;
  onMarquee?: (rect: Rect | null) => void;
  onEntityDrag?: (element: Element, delta: Point) => void;
  onHover?: (point: Point | null) => void;
  idleCursor?: string;
}

// From `useBoardDrag`: the band and objects dragged on the board are told apart from a
// click by the same rule, and two copies of it is how they stop agreeing.

// `setPointerCapture` throws if the pointer isn't active, and isn't implemented
// outside a browser.
function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Capture is a refinement, not a requirement for panning.
  }
}

function releasePointer(element: Element, pointerId: number): void {
  try {
    if (element.hasPointerCapture?.(pointerId))
      element.releasePointerCapture(pointerId);
  } catch {
    // Already released, or unsupported.
  }
}

// Trackpad pinch arrives as a wheel event with ctrlKey set and much smaller deltas.
const WHEEL_INTENSITY = 0.0015;
const PINCH_INTENSITY = 0.01;
// Firefox reports a mouse wheel in lines; the rest of the code thinks in pixels.
const LINE_PX = 16;

/** One notch of a mouse wheel, in px. Chromium says 100; X11 devices behind it, 120. */
const WHEEL_NOTCHES = [100, 120];

/**
 * A wheel and a trackpad both arrive as `wheel`, and the deltas are the only thing
 * that tells them apart: a wheel moves in notches, a trackpad in small fractions
 * of one many times a second. Lines and pages are a wheel — no trackpad sends them.
 */
function isWheelNotch(event: WheelEvent, deltaY: number): boolean {
  if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return true;
  const px = Math.round(Math.abs(deltaY));
  return WHEEL_NOTCHES.some((notch) => px >= notch && px % notch === 0);
}

interface PanState {
  pointerId: number;
  lastX: number;
  lastY: number;
  travel: number;
  button: number;
  startTarget: EventTarget | null;
}

export function BoardCanvas({
  camera,
  onCameraChange,
  children,
  className,
  onContextTarget,
  onFileDrop,
  onFileDragOver,
  fitTo,
  onRecentre,
  overlay,
  backdrop,
  onViewportChange,
  onBackgroundClick,
  onMarquee,
  onEntityDrag,
  onHover,
  idleCursor = "default",
}: BoardCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<PanState | null>(null);

  // The browser fires a click after a rubber-band drag; without this it reaches the
  // bare-board handler and clears the selection the band just made.
  const suppressClickRef = useRef<{ x: number; y: number } | null>(null);

  const entityRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    element: Element;
  } | null>(null);
  const hasFittedRef = useRef(false);
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });

  // A permanent `will-change: transform` makes the browser rasterize the layer once and
  // scale the bitmap as you zoom, so text and cards go soft; set it only while moving.
  const [interacting, setInteracting] = useState(false);
  const settleTimer = useRef(0);

  const [marquee, setMarquee] = useState<Rect | null>(null);
  const marqueeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);

  const markInteracting = useCallback(() => {
    setInteracting(true);
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => setInteracting(false), 180);
  }, []);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const changeRef = useRef(onCameraChange);
  changeRef.current = onCameraChange;

  const markInteractingRef = useRef(markInteracting);
  markInteractingRef.current = markInteracting;

  const onEntityDragRef = useRef(onEntityDrag);
  onEntityDragRef.current = onEntityDrag;

  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    // Native and non-passive: React's synthetic wheel listener is passive, so
    // `preventDefault` there is ignored and the page scrolls behind the zoom.
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();

      const bounds = viewport.getBoundingClientRect();
      const cursor = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };

      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? LINE_PX
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? bounds.height
            : 1;
      const deltaX = event.deltaX * unit;
      const deltaY = event.deltaY * unit;

      markInteractingRef.current();

      // A pinch sets ctrlKey. A trackpad's two-finger drag pans; a mouse wheel zooms,
      // which is what it did before gestures were read apart.
      const pinch = event.ctrlKey || event.metaKey;
      if (!pinch && !isWheelNotch(event, deltaY)) {
        changeRef.current(panBy(cameraRef.current, -deltaX, -deltaY));
        return;
      }

      const intensity = pinch ? PINCH_INTENSITY : WHEEL_INTENSITY;
      const factor = Math.exp(-deltaY * intensity);
      changeRef.current(
        zoomAt(cameraRef.current, cursor, cameraRef.current.zoom * factor),
      );
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const measure = (): void => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setViewport((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onViewportChange?.(viewport);
  }, [viewport, onViewportChange]);

  useLayoutEffect(() => {
    if (hasFittedRef.current || !fitTo || fitTo.length === 0) return;

    const viewport = viewportRef.current;
    if (!viewport) return;

    const bounds = viewport.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const fitted = fitBounds(
      fitTo,
      { width: bounds.width, height: bounds.height },
      56,
    );
    if (!fitted) return;

    hasFittedRef.current = true;
    changeRef.current(fitted);
  }, [fitTo]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Left on bare board starts a rubber-band selection; objects inside the board
      // stop the event themselves, so button 0 here is empty cork.
      if (event.button === 0) {
        if (!onMarquee || event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        marqueeRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX - bounds.left,
          startY: event.clientY - bounds.top,
        };
        capturePointer(event.currentTarget, event.pointerId);
        return;
      }

      if (event.button !== 1 && event.button !== 2) return;

      event.preventDefault();

      // Middle-drag on an entity moves it, on bare board pans; checked before the pan
      // starts so the two never both run. Right-drag is left to the pin's editor.
      const entity =
        event.button === 1 && onEntityDrag
          ? ((event.target as Element | null)?.closest?.(
              "[data-board-entity]",
            ) ?? null)
          : null;

      if (entity) {
        entityRef.current = {
          pointerId: event.pointerId,
          lastX: event.clientX,
          lastY: event.clientY,
          element: entity,
        };
        capturePointer(event.currentTarget, event.pointerId);
        return;
      }

      panRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        travel: 0,
        button: event.button,
        startTarget: event.target,
      };

      capturePointer(event.currentTarget, event.pointerId);
    },
    [onEntityDrag, onMarquee],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const band = marqueeRef.current;
      if (band && band.pointerId === event.pointerId) {
        const bounds = event.currentTarget.getBoundingClientRect();
        const rect = rectFromPoints(
          { x: band.startX, y: band.startY },
          { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        );
        setMarquee(rect);
        onMarquee?.(rect);
        return;
      }

      if (
        !entityRef.current &&
        !panRef.current &&
        !marqueeRef.current &&
        onHoverRef.current
      ) {
        const bounds = event.currentTarget.getBoundingClientRect();
        onHoverRef.current({
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        });
      }

      const entity = entityRef.current;
      if (entity && entity.pointerId === event.pointerId) {
        const dx = event.clientX - entity.lastX;
        const dy = event.clientY - entity.lastY;
        entity.lastX = event.clientX;
        entity.lastY = event.clientY;

        // Pointer deltas are screen px; divide by zoom so the entity keeps up with the cursor.
        const zoom = cameraRef.current.zoom || 1;
        onEntityDragRef.current?.(entity.element, {
          x: dx / zoom,
          y: dy / zoom,
        });
        return;
      }

      const pan = panRef.current;
      if (!pan || pan.pointerId !== event.pointerId) return;

      const dx = event.clientX - pan.lastX;
      const dy = event.clientY - pan.lastY;

      // Accumulate travel, so a slow drag still counts even if no single step exceeded it.
      pan.travel += Math.abs(dx) + Math.abs(dy);
      pan.lastX = event.clientX;
      pan.lastY = event.clientY;

      markInteractingRef.current();
      changeRef.current(panBy(cameraRef.current, dx, dy));
    },
    [onMarquee],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (marqueeRef.current?.pointerId === event.pointerId) {
        const band = marqueeRef.current;
        marqueeRef.current = null;
        setMarquee(null);
        releasePointer(event.currentTarget, event.pointerId);
        onMarquee?.(null);

        // A travelling press is a band, not a click, but the browser still sends one;
        // swallow exactly that. The band start is viewport-local, so measure in that frame.
        const bounds = event.currentTarget.getBoundingClientRect();
        const travel =
          Math.abs(event.clientX - bounds.left - band.startX) +
          Math.abs(event.clientY - bounds.top - band.startY);
        if (travel >= DRAG_THRESHOLD) {
          suppressClickRef.current = {
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
          };
        }
        return;
      }

      const entity = entityRef.current;
      if (entity && entity.pointerId === event.pointerId) {
        entityRef.current = null;
        releasePointer(event.currentTarget, event.pointerId);
        return;
      }

      const pan = panRef.current;
      if (!pan || pan.pointerId !== event.pointerId) return;

      panRef.current = null;
      releasePointer(event.currentTarget, event.pointerId);

      // Right-drag pans and right-click edits share a button, so travel decides which.
      if (pan.button === 2 && pan.travel < DRAG_THRESHOLD && onContextTarget) {
        onContextTarget({
          clientX: event.clientX,
          clientY: event.clientY,
          target: pan.startTarget,
        });
      }
    },
    [onContextTarget, onMarquee],
  );

  // The world wrapper is sized by its children, so a click outside the paper lands on
  // the viewport itself and `target === currentTarget` means empty board.
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const swallowed = suppressClickRef.current;
      if (swallowed) {
        suppressClickRef.current = null;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          Math.abs(event.clientX - box.left - swallowed.x) <= CLICK_SLOP &&
          Math.abs(event.clientY - box.top - swallowed.y) <= CLICK_SLOP
        ) {
          return;
        }
      }

      if (event.button !== 0 || event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      onBackgroundClick?.({
        point: {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        },
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      });
    },
    [onBackgroundClick],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const pan = panRef.current;
      if (pan && pan.pointerId === event.pointerId) panRef.current = null;

      const entity = entityRef.current;
      if (entity && entity.pointerId === event.pointerId)
        entityRef.current = null;

      const band = marqueeRef.current;
      if (band && band.pointerId === event.pointerId) {
        marqueeRef.current = null;
        setMarquee(null);
        onMarquee?.(null);
      }
    },
    [onMarquee],
  );

  return (
    <div
      ref={viewportRef}
      className={`board-canvas relative overflow-hidden ${className ?? ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={() => onHoverRef.current?.(null)}
      onClick={handleClick}
      onDrop={onFileDrop}
      onDragOver={onFileDragOver}
      // Otherwise the browser menu fires on every right-drag release.
      onContextMenu={(event) => event.preventDefault()}
      style={{
        touchAction: "none",
        cursor: panRef.current ? "grabbing" : idleCursor,
      }}
      data-testid="board-canvas"
    >
      {backdrop?.(viewport)}

      <div
        data-testid="board-world"
        style={{
          // translate then scale, so a board point p lands at (p - camera) * zoom — the
          // same transform `camera.ts` models.
          transform: `translate3d(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px, 0) scale(${camera.zoom})`,
          transformOrigin: "0 0",
          willChange: interacting ? "transform" : "auto",
          position: "absolute",
          top: 0,
          left: 0,
        }}
      >
        {children}
      </div>

      {marquee && (
        <div
          className="marquee"
          data-testid="marquee"
          style={{
            left: marquee.x,
            top: marquee.y,
            width: marquee.width,
            height: marquee.height,
          }}
        />
      )}

      {overlay}

      <ZoomReadout
        camera={camera}
        onCameraChange={onCameraChange}
        onRecentre={onRecentre}
      />
    </div>
  );
}

function ZoomReadout({
  camera,
  onCameraChange,
  onRecentre,
}: {
  camera: Camera;
  onCameraChange: (next: Camera) => void;
  onRecentre?: () => void;
}) {
  return (
    <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded border border-parchment-edge/30 bg-cork-900/80 px-1 py-1 text-[11px] backdrop-blur-sm">
      {onRecentre ? (
        <button
          type="button"
          data-testid="recentre"
          onClick={onRecentre}
          className="px-1.5 text-board-ink-soft transition hover:text-board-ink"
          aria-label="Bring the whole board back into view"
          title="Bring the whole board back into view"
        >
          <Focus size={13} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={() =>
          onCameraChange(zoomAt(camera, { x: 0, y: 0 }, camera.zoom / 1.25))
        }
        className="px-1.5 text-board-ink-soft transition hover:text-board-ink"
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        onClick={() => onCameraChange({ ...camera, zoom: 1 })}
        className="min-w-[38px] text-center text-board-ink-soft tabular-nums transition hover:text-board-ink"
        title="Reset zoom to 100%"
      >
        {Math.round(camera.zoom * 100)}%
      </button>
      <button
        type="button"
        onClick={() =>
          onCameraChange(zoomAt(camera, { x: 0, y: 0 }, camera.zoom * 1.25))
        }
        className="px-1.5 text-board-ink-soft transition hover:text-board-ink"
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  );
}
