// The bar is in viewport space because the world layer is a transformed stacking context:
// a z-index inside it cannot lift the bar above the palette in the corner.

import { Fragment, useLayoutEffect, useRef, useState } from 'react'

import { EDGE_FAMILIES, edgeClipPath, type EdgeStyle } from './edges'

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
  seed: number
  edge: EdgeStyle
  anchor: Box
  onPick: (style: EdgeStyle) => void
}

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
  side: 'below' | 'above'
}

export const EDGE_PICKER_GAP = 44

export const EDGE_PICKER_MARGIN = 6

// Flips above when it would not fit below; clamping is a last resort, `max()` before `min()`.
// Pure and exported because jsdom has no layout — the component only feeds it measured boxes.
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

  // Measured after mount: the bar's height is whatever the swatches and labels come to.
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
        left: placement?.left ?? anchor.left,
        top: placement?.top ?? anchor.top + anchor.height + EDGE_PICKER_GAP,
        visibility: placement ? 'visible' : 'hidden',
      }}
      // A press on the bar is not a press on the cork.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {EDGE_FAMILIES.map((family, index) => (
        <Fragment key={family.id}>
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
