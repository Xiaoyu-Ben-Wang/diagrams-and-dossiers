/**
 * The board surface: an infinite canvas you navigate like Miro.
 *
 *   scroll          zoom, anchored at the cursor
 *   right or middle drag   pan
 *   right-click (no drag)  context — edit the pin under the cursor
 *
 * The camera lives in the parent rather than here, because other things drive
 * it too — the timeline flies it to a moment, and a future "fit to selection"
 * will want it. This component owns only the *interaction* and the transform.
 *
 * The whole world is one CSS transform on a single element. That's what keeps
 * zoom free: text inside an article never re-lays-out, it's just scaled. It is
 * also what keeps text anchors stable, since paper-space coordinates don't
 * change when the camera moves.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { fitBounds, panBy, zoomAt, type Camera, type Rect, type Viewport } from './camera'

export interface BoardContextTarget {
  clientX: number
  clientY: number
  /** What was under the cursor when the right button went down. */
  target: EventTarget | null
}

export interface BoardCanvasProps {
  camera: Camera
  onCameraChange: (next: Camera) => void
  children: ReactNode
  className?: string
  /** Fired on a right-click that did not turn into a drag. */
  onContextTarget?: (target: BoardContextTarget) => void
  /**
   * Board-space rects to frame once, the first time they become available.
   * Used to open on the article rather than on empty cork. It fires once only —
   * re-framing whenever the content changed would yank the view out from under
   * someone mid-edit.
   */
  fitTo?: Rect[]
  /**
   * Rendered behind the world, in *viewport* space, and handed the measured
   * viewport size.
   *
   * A render prop rather than a plain child, because backdrops like the grid
   * need the viewport dimensions and the transform — and putting them inside the
   * world would mean scaling a huge element instead of drawing crisply at screen
   * resolution. It's called on every render, so it must be cheap.
   */
  backdrop?: (viewport: Viewport) => ReactNode
}

/** Pointer travel, in pixels, above which a press is a drag rather than a click. */
const DRAG_THRESHOLD = 5

/**
 * Capture the pointer if the environment supports it.
 *
 * `setPointerCapture` throws if the pointer isn't active — and isn't implemented
 * at all outside a browser. Neither is worth failing a drag over: capture is a
 * refinement that keeps a fast drag from escaping the viewport, not a
 * requirement for panning to work.
 */
function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // No capture; the drag still tracks while the pointer is over the board.
  }
}

function releasePointer(element: Element, pointerId: number): void {
  try {
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId)
  } catch {
    // Already released, or unsupported.
  }
}

/**
 * Wheel sensitivity. Trackpad pinch arrives as a wheel event with ctrlKey set
 * and much smaller deltas, so it needs a steeper multiplier to feel the same.
 */
const WHEEL_INTENSITY = 0.0015
const PINCH_INTENSITY = 0.01

interface PanState {
  pointerId: number
  lastX: number
  lastY: number
  travel: number
  button: number
  startTarget: EventTarget | null
}

export function BoardCanvas({
  camera,
  onCameraChange,
  children,
  className,
  onContextTarget,
  fitTo,
  backdrop,
}: BoardCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<PanState | null>(null)
  const hasFittedRef = useRef(false)
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 })

  // The wheel listener reads the camera through a ref so it doesn't have to be
  // torn down and rebuilt on every frame of a zoom.
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  const changeRef = useRef(onCameraChange)
  changeRef.current = onCameraChange

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    // Registered natively and non-passive: React's synthetic wheel listener is
    // passive, so `preventDefault` there is ignored and the page scrolls behind
    // the zoom.
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault()

      const bounds = viewport.getBoundingClientRect()
      const cursor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }

      const intensity = event.ctrlKey ? PINCH_INTENSITY : WHEEL_INTENSITY
      const factor = Math.exp(-event.deltaY * intensity)

      changeRef.current(zoomAt(cameraRef.current, cursor, cameraRef.current.zoom * factor))
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [])

  // Track the viewport size for the backdrop and for fit-bounds. Only stored in
  // state when it actually changes, so a backdrop that reads it doesn't cause a
  // render loop.
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return

    const measure = (): void => {
      const width = element.clientWidth
      const height = element.clientHeight
      setViewport((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      )
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Frame the content the first time we know how big it is. Guarded so it
  // happens exactly once: someone who has panned somewhere deliberately should
  // not be dragged back because the article grew a line.
  useLayoutEffect(() => {
    if (hasFittedRef.current || !fitTo || fitTo.length === 0) return

    const viewport = viewportRef.current
    if (!viewport) return

    const bounds = viewport.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return

    const fitted = fitBounds(fitTo, { width: bounds.width, height: bounds.height }, 56)
    if (!fitted) return

    hasFittedRef.current = true
    changeRef.current(fitted)
  }, [fitTo])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Button 1 is middle, 2 is right. Left is reserved for the board itself —
    // pinning, selecting, drawing yarn.
    if (event.button !== 1 && event.button !== 2) return

    event.preventDefault()
    panRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      travel: 0,
      button: event.button,
      startTarget: event.target,
    }

    capturePointer(event.currentTarget, event.pointerId)
  }, [])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return

    const dx = event.clientX - pan.lastX
    const dy = event.clientY - pan.lastY

    // Accumulate absolute travel, so a slow drag still counts as a drag even if
    // no single step exceeded the threshold.
    pan.travel += Math.abs(dx) + Math.abs(dy)
    pan.lastX = event.clientX
    pan.lastY = event.clientY

    changeRef.current(panBy(cameraRef.current, dx, dy))
  }, [])

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const pan = panRef.current
      if (!pan || pan.pointerId !== event.pointerId) return

      panRef.current = null
      releasePointer(event.currentTarget, event.pointerId)

      // A right press that never became a drag is a context click. This is why
      // the travel is tracked rather than acted on immediately: right-drag pans,
      // right-click edits, and they share a button.
      if (pan.button === 2 && pan.travel < DRAG_THRESHOLD && onContextTarget) {
        onContextTarget({
          clientX: event.clientX,
          clientY: event.clientY,
          target: pan.startTarget,
        })
      }
    },
    [onContextTarget],
  )

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (pan && pan.pointerId === event.pointerId) panRef.current = null
  }, [])

  return (
    <div
      ref={viewportRef}
      className={`relative overflow-hidden ${className ?? ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      // The browser menu would otherwise fire on every right-drag release.
      onContextMenu={(event) => event.preventDefault()}
      style={{ touchAction: 'none', cursor: panRef.current ? 'grabbing' : 'default' }}
      data-testid="board-canvas"
    >
      {/* Rendered even before the first measurement lands. Guarding on a
          non-zero viewport would flash a bare board on every mount, and a
          backdrop that renders nothing at zero size is harmless. */}
      {backdrop?.(viewport)}

      <div
        style={{
          // translate then scale, so a board point p lands at (p - camera) * zoom
          // — the same transform `camera.ts` models.
          transform: `translate3d(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px, 0) scale(${camera.zoom})`,
          transformOrigin: '0 0',
          willChange: 'transform',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      >
        {children}
      </div>

      <ZoomReadout camera={camera} onCameraChange={onCameraChange} />
    </div>
  )
}

/** A small scale indicator, and a way back to 100%. */
function ZoomReadout({
  camera,
  onCameraChange,
}: {
  camera: Camera
  onCameraChange: (next: Camera) => void
}) {
  return (
    <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded border border-parchment-edge/30 bg-cork-900/80 px-1 py-1 text-[11px] backdrop-blur-sm">
      <button
        type="button"
        onClick={() => onCameraChange(zoomAt(camera, { x: 0, y: 0 }, camera.zoom / 1.25))}
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
        onClick={() => onCameraChange(zoomAt(camera, { x: 0, y: 0 }, camera.zoom * 1.25))}
        className="px-1.5 text-board-ink-soft transition hover:text-board-ink"
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  )
}
