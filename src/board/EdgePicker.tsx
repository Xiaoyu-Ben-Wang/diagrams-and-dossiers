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

import type { Point } from './yarn'
import { EDGE_STYLES, edgeClipPath, type EdgeStyle } from './edges'

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
   * Where to hang the bar, in coordinates relative to the board's own box.
   *
   * The board converts the picture's swept box through the camera and hands
   * the answer in, so this never has to know what a zoom is.
   */
  at: Point
  onPick: (style: EdgeStyle) => void
}

export function EdgePicker({ seed, edge, at, onPick }: EdgePickerProps) {
  return (
    <div
      role="group"
      aria-label="Picture border"
      data-testid="edge-picker"
      className="edge-picker absolute"
      style={{
        left: at.x,
        top: at.y,
        // Translated so its centre — not its corner — sits under the pin, and
        // kept upright however the sheet above it hangs: the bar is a control,
        // and a control that tilts with the thing it controls is harder to
        // read for no gain.
        transform: 'translateX(-50%)',
      }}
      // The bar floats over the board; a press on it is not a press on the cork.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {EDGE_STYLES.map((style) => (
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
    </div>
  )
}
