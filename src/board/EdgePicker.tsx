/**
 * The bar of edge treatments for a selected picture.
 *
 * It appears with the selection and goes away with it. Ten styles is too many
 * to be a permanent toolbar on a board you are trying to read, and the choice
 * only means anything while you are looking at the thing it applies to.
 *
 * Each swatch is a real crop rather than an icon: the same `edgeClipPath` the
 * picture uses, at swatch size, from the same seed — so what the button shows
 * is what picking it produces, and a picture whose border is already nibbled
 * has a nibbled swatch. Drawing ten little pictures by hand would drift from
 * the generator the first time a preset was retuned.
 *
 * The bar hangs under the picture in *viewport* space, not on the cork, and is
 * placed by the board which is the only thing that knows the camera. That is
 * not a detail: inside the world layer it sits in a transformed element, which
 * is its own stacking context, so its z-index cannot lift it above anything
 * that is a sibling of that layer — and the palette in the corner is. The
 * swatches underneath it could not be clicked.
 *
 * Viewport space also means it does not scale with the zoom, which is what the
 * tooltip and the context menu already do: a control nobody can read at 40% is
 * not a control.
 */

import { Fragment, useLayoutEffect, useRef, useState } from 'react'

import { EDGE_FAMILIES, edgeClipPath, type EdgeStyle } from './edges'

/** What each style is called on screen. */
const EDGE_LABELS: Readonly<Record<EdgeStyle, string>> = {
  clean: 'Clean',
  burnt: 'Burnt',
  stamped: 'Stamped',
  torn: 'Torn',
  deckled: 'Deckled',
  scalloped: 'Scalloped',
  scorched: 'Scorched',
  frayed: 'Frayed',
  nibbled: 'Nibbled',
  chipped: 'Chipped',
}

/** One-line descriptions, for the hover title. */
const EDGE_HINTS: Readonly<Record<EdgeStyle, string>> = {
  clean: 'No crop — the picture as it arrived',
  burnt: 'Charred away, with the corners gone',
  stamped: 'Perforated like a sheet of stamps',
  torn: 'Ripped, with a ragged and uneven bite',
  deckled: 'The soft wavy edge of handmade paper',
  scalloped: 'A regular scalloped trim',
  scorched: 'Burnt through on one side only',
  frayed: 'Fabric unravelling at the edge',
  nibbled: 'Gnawed, with bites of a few sizes',
  chipped: 'Hard flakes struck off, leaving straight runs',
}

const SWATCH_WIDTH = 46
const SWATCH_HEIGHT = 34
export interface EdgePickerProps {
  /** The seed the picture's damage is generated from, so swatches match it. */
  seed: number
  edge: EdgeStyle
  /**
   * The picture's footprint in the board's own box, in viewport px.
   *
   * A box rather than a point, because the bar has to know whether it fits
   * below the picture before it decides where to go — and only the board knows
   * the camera, so the board converts and this places.
   */
  anchor: Box
  onPick: (style: EdgeStyle) => void
}

/** A rectangle in the bar's own coordinate space. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface PickerPlacement {
  left: number
  top: number
  /** Which side of the picture the bar ended up on. */
  side: 'below' | 'above'
}

/** How far the bar stands off the picture, in screen px. */
export const EDGE_PICKER_GAP = 44

/** Closest the bar may come to the edge of the board. */
export const EDGE_PICKER_MARGIN = 6

/**
 * Where the bar goes, in coordinates relative to the board's box.
 *
 * Under the picture by default — it hangs off the bottom edge, reading order —
 * flipping above when it would not fit below and there is room up there. This
 * is the fix for a real bug: the bar used to be positioned unconditionally
 * below, so a picture low on the board put its bar past the bottom of the
 * board, which clips, and the last thing to go was the row of labels — the bar
 * came up with ten swatches and no way to tell which was which.
 *
 * Clamping is the last resort rather than the first, and it is `max()` before
 * `min()` for the reason `placeTooltip` gives: a bar with nowhere to go should
 * lose its far edge, not its first swatch.
 *
 * Pure and exported because the DOM under test has no layout — this is the
 * part worth testing, and the component only feeds it measured boxes.
 */
export function placeEdgePicker(
  anchor: Box,
  size: Size,
  viewport: Size,
  gap: number = EDGE_PICKER_GAP,
  margin: number = EDGE_PICKER_MARGIN,
): PickerPlacement {
  const centreX = anchor.left + anchor.width / 2
  const maxLeft = Math.max(margin, viewport.width - margin - size.width)
  const left = Math.min(Math.max(centreX - size.width / 2, margin), maxLeft)

  const maxTop = Math.max(margin, viewport.height - margin - size.height)
  let top = anchor.top + anchor.height + gap
  let side: PickerPlacement['side'] = 'below'
  if (top + size.height > viewport.height - margin && anchor.top - gap - size.height >= margin) {
    top = anchor.top - gap - size.height
    side = 'above'
  }

  return { left: Math.round(left), top: Math.round(Math.min(Math.max(top, margin), maxTop)), side }
}

export function EdgePicker({ seed, edge, anchor, onPick }: EdgePickerProps) {
  const barRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<PickerPlacement | null>(null)

  /**
   * Placed after measuring, not from the anchor alone.
   *
   * The bar's height is whatever ten swatches and a row of labels come to, and
   * the alternative — a constant here that has to be kept in step with the
   * stylesheet — is a number that is wrong the first time a label wraps. The
   * parent is the box it has to stay inside, and it is also the box the
   * anchor's coordinates are already relative to.
   */
  useLayoutEffect(() => {
    const bar = barRef.current
    const parent = bar?.offsetParent as HTMLElement | null
    if (!bar || !parent) return
    setPlacement(
      placeEdgePicker(
        anchor,
        { width: bar.offsetWidth, height: bar.offsetHeight },
        { width: parent.clientWidth, height: parent.clientHeight },
      ),
    )
  }, [anchor])

  return (
    <div
      ref={barRef}
      role="group"
      aria-label="Picture border"
      data-testid="edge-picker"
      data-side={placement?.side}
      className="edge-picker absolute"
      style={{
        // Unplaced until the measurement lands. Hidden rather than drawn at
        // the origin for that one frame, which would be a bar flashing in the
        // board's corner every time a picture is selected.
        left: placement?.left ?? anchor.left,
        top: placement?.top ?? anchor.top + anchor.height + EDGE_PICKER_GAP,
        visibility: placement ? 'visible' : 'hidden',
      }}
      // The bar floats over the board; a press on it is not a press on the cork.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {EDGE_FAMILIES.map((family, index) => (
        <Fragment key={family.id}>
          {/* The break between the families. Unlabelled on purpose: the swatches
              already say which is which, and the mark is here only so the eye
              reads two runs rather than one long row. */}
          {index > 0 ? (
            <span className="edge-picker-split" aria-hidden="true" />
          ) : null}
          {family.styles.map((style) => (
            <button
              key={style}
              type="button"
              data-testid={`edge-${style}`}
              aria-pressed={style === edge}
              title={EDGE_HINTS[style]}
              className={`edge-swatch ${style === edge ? 'is-active' : ''}`}
              onClick={() => onPick(style)}
            >
              <span
                aria-hidden="true"
                className="edge-swatch-face"
                style={{
                  width: SWATCH_WIDTH,
                  height: SWATCH_HEIGHT,
                  clipPath: edgeClipPath(style, SWATCH_WIDTH, SWATCH_HEIGHT, seed),
                }}
              />
              <span className="edge-swatch-label">{EDGE_LABELS[style]}</span>
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  )
}
