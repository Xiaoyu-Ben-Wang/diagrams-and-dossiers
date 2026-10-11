export const CAMERA_FLIGHT_MS = 450;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * How long a thing someone else is moving takes to close the gap to where it was
 * last reported. Shared by the cursors and by the things they are holding,
 * deliberately: two different constants would put a person's pointer and the note
 * they are dragging in visibly different places, which reads as lag rather than
 * as smoothing. Reports arrive every 50ms; this is where the steps stop showing.
 */
export const PEER_EASE_MS = 65;
