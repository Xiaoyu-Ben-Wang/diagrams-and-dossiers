import type { Point } from "./yarn";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.5;

/** Breathing room left around the target when framing content, in screen px. */
export const DEFAULT_PADDING = 64;

export const IDENTITY_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function boardToScreen(camera: Camera, point: Point): Point {
  return {
    x: (point.x - camera.x) * camera.zoom,
    y: (point.y - camera.y) * camera.zoom,
  };
}

export function screenToBoard(camera: Camera, point: Point): Point {
  return {
    x: point.x / camera.zoom + camera.x,
    y: point.y / camera.zoom + camera.y,
  };
}

/** Zero-size rects are included: an unmeasured article is still worth framing. */
export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * How far past the content the viewport may be dragged, in screens. Generous on
 * purpose: this is a tether, so the board cannot be lost, not a cage.
 */
export const PAN_MARGIN_SCREENS = 0.75;

/**
 * Keeps the viewport within `marginScreens` screens of `content`, each way. Read
 * against the content's box as it is now, so dragging an item further out takes
 * the limit out with it.
 *
 * The range is never empty: it is the content's extent plus half a screen, and
 * content cannot be narrower than nothing.
 */
export function clampCameraToContent(
  camera: Camera,
  content: Rect,
  viewport: Viewport,
  marginScreens: number = PAN_MARGIN_SCREENS,
): Camera {
  const viewWidth = viewport.width / camera.zoom;
  const viewHeight = viewport.height / camera.zoom;
  const marginX = viewWidth * marginScreens;
  const marginY = viewHeight * marginScreens;

  const lowX = content.x - marginX;
  const lowY = content.y - marginY;
  const highX = content.x + content.width + marginX - viewWidth;
  const highY = content.y + content.height + marginY - viewHeight;

  return {
    ...camera,
    x: Math.min(highX, Math.max(lowX, camera.x)),
    y: Math.min(highY, Math.max(lowY, camera.y)),
  };
}

/** Returns null when there is nothing to frame. */
export function fitBounds(
  targets: Rect[],
  viewport: Viewport,
  padding: number = DEFAULT_PADDING,
): Camera | null {
  const bounds = unionRect(targets);
  if (!bounds) return null;

  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);

  // A single point, or a zero-size rect, has no scale to fit — identity zoom centres it rather than dividing by zero.
  const zoom =
    bounds.width <= 0 || bounds.height <= 0
      ? 1
      : clampZoom(
          Math.min(
            availableWidth / bounds.width,
            availableHeight / bounds.height,
          ),
        );

  const centreX = bounds.x + bounds.width / 2;
  const centreY = bounds.y + bounds.height / 2;

  return {
    x: centreX - viewport.width / (2 * zoom),
    y: centreY - viewport.height / (2 * zoom),
    zoom,
  };
}

/** Centres `rect` without choosing a zoom, unlike `fitBounds`. */
export function centreOn(rect: Rect, viewport: Viewport, zoom: number): Camera {
  const scale = clampZoom(zoom);
  return {
    x: rect.x + rect.width / 2 - viewport.width / (2 * scale),
    y: rect.y + rect.height / 2 - viewport.height / (2 * scale),
    zoom: scale,
  };
}

/** Keeps the board point under `screenPoint` pinned while zooming. */
export function zoomAt(
  camera: Camera,
  screenPoint: Point,
  nextZoom: number,
): Camera {
  const zoom = clampZoom(nextZoom);
  const anchor = screenToBoard(camera, screenPoint);
  return {
    x: anchor.x - screenPoint.x / zoom,
    y: anchor.y - screenPoint.y / zoom,
    zoom,
  };
}

/** `dx`/`dy` are screen-space, converted at the current zoom. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return {
    x: camera.x - dx / camera.zoom,
    y: camera.y - dy / camera.zoom,
    zoom: camera.zoom,
  };
}

export function camerasDiffer(a: Camera, b: Camera, epsilon = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) > epsilon ||
    Math.abs(a.y - b.y) > epsilon ||
    Math.abs(a.zoom - b.zoom) > 0.001
  );
}

export function lerpCamera(from: Camera, to: Camera, t: number): Camera {
  const eased = t < 0 ? 0 : t > 1 ? 1 : t;
  const zoom = from.zoom * Math.pow(to.zoom / from.zoom, eased);
  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
    zoom,
  };
}

export function easeInOut(t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return clamped * clamped * (3 - 2 * clamped);
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Touching edges count, so a zero-size rect (a pin) is inside when its point is. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

/** AABB culling, not DOM virtualization: `content-visibility: auto` breaks `getBoundingClientRect()` and with it anchor measurement. */
export function isVisible(
  rect: Rect,
  camera: Camera,
  viewport: Viewport,
  margin = 200,
): boolean {
  const topLeft = boardToScreen(camera, { x: rect.x, y: rect.y });
  const width = rect.width * camera.zoom;
  const height = rect.height * camera.zoom;

  return (
    topLeft.x + width >= -margin &&
    topLeft.y + height >= -margin &&
    topLeft.x <= viewport.width + margin &&
    topLeft.y <= viewport.height + margin
  );
}
