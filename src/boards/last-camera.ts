// Where each board was last being looked at. Beside the last-open id, and in
// localStorage for the same reason: it is read at the first paint, and a pan must
// not dirty the document — a camera that saved with the board would autosave on
// every drag of the cork.

import type { Camera } from "../board/camera";

const key = (id: string): string => `detective-board.camera.${id}`;

export function loadCameraView(id: string): Camera | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key(id));
    if (!raw) return null;
    return finite(JSON.parse(raw));
  } catch {
    // Private windows and blocked storage throw; the board then opens at the origin.
    return null;
  }
}

export function saveCameraView(id: string, camera: Camera): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      key(id),
      JSON.stringify({ x: camera.x, y: camera.y, zoom: camera.zoom }),
    );
  } catch {
    // Swallowed: where you were looking is a convenience, not the board itself.
  }
}

/** So a deleted board does not leave its view behind for a reused id. */
export function forgetCameraView(id: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key(id));
  } catch {
    // As above.
  }
}

/** Anything hand-edited or half-written resolves to nothing rather than NaN. */
function finite(raw: unknown): Camera | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { x, y, zoom } = raw as Partial<Camera>;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom))
    return null;
  return { x: x as number, y: y as number, zoom: zoom as number };
}
