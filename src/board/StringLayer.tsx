/**
 * Every string on the board, and the one being drawn.
 *
 * One `<svg>` sized 1x1 with `overflow-visible`, so its coordinate system is
 * the board's own and the paths are written in board space. Nothing scales the
 * SVG — the whole world is one CSS transform above it — which is what keeps the
 * yarn geometry independent of the camera.
 *
 * The layer is `pointer-events-none` throughout. Yarn lies on top of
 * everything, so making it hit-testable would swallow every click meant for the
 * pins and notes underneath; a click is matched against the curve's geometry
 * instead, in the board's own code. The one exception is the sag handle, which
 * is rendered after this by the board because it has to be grabbable.
 */

import type { Ref } from 'react'

import { STRING_HALO_PX } from './tuning'
import type { DrawableString } from './view'
import { seedFromKey, yarnStrands, type YarnStyle } from './yarn-style'
import { YARN_COLOR, yarnPath } from './yarn'

export interface StringLayerProps {
  /** Every string with both ends resolved to board points. */
  strings: readonly DrawableString[]
  /** Ids that should read as selected, and so draw their halo more strongly. */
  selected: ReadonlySet<string>
  hovered: string | null
  /** Which wool to draw them in. */
  style: YarnStyle
  zoom: number
  /**
   * The path the string being dragged is following, updated imperatively.
   *
   * A ref rather than a prop: the drag runs on `requestAnimationFrame` and
   * writing its `d` directly is what keeps a live string off React's render
   * path. Re-rendering the whole board every frame to move one curve is the
   * difference between a string that follows the cursor and one that lags it.
   */
  livePathRef: Ref<SVGPathElement>
  /** Whether a drag is in progress, which is all the live path's opacity means. */
  drawing: boolean
}

export function StringLayer({
  strings,
  selected,
  hovered,
  style,
  zoom,
  livePathRef,
  drawing,
}: StringLayerProps) {
  return (
    <svg
      className="pointer-events-none absolute top-0 left-0 z-20 overflow-visible"
      width={1}
      height={1}
      aria-hidden="true"
    >
      {strings.map((string) => (
        // Yarn is never dimmed with the timeline. Pins carry that signal well
        // enough on their own, and 0.12 — which reads as "faded" on a chunky
        // brass tack — is indistinguishable from absent on a 1-2px hairline, so
        // every string touching a pin newer than the cursor simply vanished.
        <g key={string.id}>
          {/* The halo sits under the strands rather than around them, so the
              wool still reads as wool. Drawn in the yarn's own colour at low
              opacity: a white glow would be invisible on the whiteboard and a
              dark one on slate, but a red one reads on every surface. */}
          {selected.has(string.id) || hovered === string.id ? (
            <path
              data-testid="yarn-halo"
              d={yarnPath(string.from, string.to, string.slack)}
              fill="none"
              stroke={YARN_COLOR}
              // Selected reads stronger than merely hovered, so the two states
              // are told apart at a glance rather than both meaning "something
              // is happening here".
              strokeOpacity={selected.has(string.id) ? 0.22 : 0.12}
              strokeWidth={STRING_HALO_PX / (zoom || 1)}
              strokeLinecap="round"
            />
          ) : null}
          {yarnStrands(style, string.from, string.to, string.slack, seedFromKey(string.id)).map(
            (strand, index) => (
              <path
                key={index}
                d={strand.d}
                fill="none"
                stroke={YARN_COLOR}
                strokeWidth={strand.width}
                strokeOpacity={strand.opacity}
                strokeLinecap="round"
              />
            ),
          )}
        </g>
      ))}

      <path
        ref={livePathRef}
        data-testid="live-yarn"
        fill="none"
        stroke={YARN_COLOR}
        strokeWidth={2.5}
        strokeLinecap="round"
        opacity={drawing ? 0.95 : 0}
      />
    </svg>
  )
}
