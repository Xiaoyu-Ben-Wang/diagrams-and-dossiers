import { HANDLE_SIZE } from '../tuning'
import { useBoardDrag } from '../useBoardDrag'
import { pointOnYarn, YARN_COLOR, type Point } from '../yarn'

/**
 * The handle on a selected string: the thing you haul up and down to change how
 * much the string sags.
 *
 * Drawn as a bare double-headed arrow rather than as a brass bead. The bead
 * matched the tacks, which made it read as another object resting on the board
 * — something you might click, not something you drag. An arrow is a control,
 * and this is the one part of the board that is one.
 *
 * Its own component so the drag hook lives here, and so the gesture is bound to
 * one string by construction rather than through a ref of "which string is
 * selected right now". Only the vertical component is used — the sag is a
 * single number, and letting sideways travel feed into it would make the string
 * lurch whenever the hand drifted.
 */
export function YarnBead({
  from,
  to,
  slack,
  zoom,
  onSag,
}: {
  from: Point
  to: Point
  slack: number
  zoom: number
  onSag: (dy: number) => void
}) {
  const drag = useBoardDrag({ zoom, onDrag: (delta) => onSag(delta.y) })
  // The curve's lowest point is the middle of the rope, and the only part of it
  // that means "tightness" to the eye.
  const apex = pointOnYarn(from, to, 0.5, slack)

  return (
    <button
      type="button"
      data-testid="yarn-bead"
      aria-label="Drag up or down to adjust how much the string sags"
      className="yarn-bead tack-enter absolute"
      style={{
        left: apex.x - HANDLE_SIZE / 2,
        top: apex.y - HANDLE_SIZE / 2,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
        touchAction: 'none',
      }}
      {...drag}
    >
      {/* Stroked rather than filled, so it stays legible over the string it
          sits on: the shaft crosses the yarn, and a solid glyph in the same red
          would merge with it. */}
      <svg viewBox="0 0 20 20" className="yarn-bead-glyph" aria-hidden="true">
        <path
          d="M 10 4.5 V 15.5 M 6.4 8.1 L 10 4.5 L 13.6 8.1 M 6.4 11.9 L 10 15.5 L 13.6 11.9"
          fill="none"
          stroke={YARN_COLOR}
          strokeWidth={2.1}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

