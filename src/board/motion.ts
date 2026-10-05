/**
 * How the board moves, when it is allowed to.
 *
 * Small on purpose. CSS animations already honour `prefers-reduced-motion` on
 * their own (`index.css`, `PinTooltip.css`, `ContextMenu.css` all switch off
 * their transitions), but a `requestAnimationFrame` loop is invisible to that
 * media query and has to ask. This is the one place that asks, so the next
 * animated thing does not add a second `matchMedia` call next to it — there was
 * already one inline in `theme/Ambient.tsx` before this.
 */

/** How long a camera flight takes, in milliseconds. */
export const CAMERA_FLIGHT_MS = 450

/**
 * Whether the person has asked for less movement.
 *
 * Asked at the moment of the gesture rather than cached at module load: the
 * setting can change while the tab is open, and a board that went on animating
 * until it was reloaded would be a strange thing to explain.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
