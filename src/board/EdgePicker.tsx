/**
 * The bar of edge treatments for a selected picture.
 *
 * It appears with the selection and goes away with it. Ten styles is too many
 * to be a permanent toolbar on a board you are trying to read, and the choice
 * only means anything while you are looking at the thing it applies to.
 *
 * Each swatch is a real crop rather than an icon: the same `edgeClipPath` the
 * picture uses, at swatch size, seeded from the same id — so what the button
 * shows is what picking it produces, and a picture whose border is already
 * nibbled has a nibbled swatch. Drawing ten little pictures by hand would drift
 * from the generator the first time a preset was retuned.
 *
 * The bar hangs in board space under the picture and is counter-rotated, so it
 * stays upright and horizontal while the sheet above it is tilted.
 */

import type { Rect } from './camera'
import { EDGE_STYLES, edgeClipPath, seedFromKey, type EdgeStyle } from './edges'

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
/** How far under the picture the bar hangs, in board px. */
const DROP = 44

export interface EdgePickerProps {
  /** The picture's id — the seed its damage is derived from. */
  id: string
  edge: EdgeStyle
  /** The picture's swept box in board space, to hang the bar beneath. */
  box: Rect
  /** The sheet's angle in degrees, so the bar can be counter-rotated upright. */
  tilt: number
  onPick: (style: EdgeStyle) => void
}

export function EdgePicker({ id, edge, box, tilt, onPick }: EdgePickerProps) {
  return (
    <div
      role="group"
      aria-label="Picture border"
      data-testid="edge-picker"
      className="edge-picker absolute"
      style={{
        left: box.x + box.width / 2,
        top: box.y + box.height + DROP,
        // Counter-rotated so the bar reads the same however the sheet hangs,
        // and translated so its centre — not its corner — sits under the pin.
        transform: `translateX(-50%) rotate(${-tilt}deg)`,
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
              clipPath: edgeClipPath(style, SWATCH_WIDTH, SWATCH_HEIGHT, seedFromKey(id)),
            }}
          />
          <span className="edge-swatch-label">{EDGE_LABELS[style]}</span>
        </button>
      ))}
    </div>
  )
}
