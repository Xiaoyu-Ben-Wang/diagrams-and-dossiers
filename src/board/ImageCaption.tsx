/**
 * The caption under a selected picture: what it is called, and what it is a
 * picture of.
 *
 * A form rather than a label, because a dropped photograph arrives with a
 * filename and nothing else — the name it gets here is the one a mention
 * resolves against, and the description is the sentence nothing else on the
 * board was saying.
 *
 * ## Why this is not inside `ImageCard`
 *
 * It was, first, and it was wrong. The card lives inside the world layer, which
 * is one big scaled transform, so a `height: 96px` caption rendered at 53px on
 * a board zoomed to 55% — and the border bar, placed by a screen-pixel constant
 * that no longer matched, hung 90px below the fields it was meant to sit under.
 *
 * The same argument the border bar makes settles it: a control nobody can read
 * at 40% is not a control. The bar, the tooltip and the context menu are all in
 * viewport space for this reason, and a text field wants it more than any of
 * them. It also means the caption stays upright without counter-rotating against
 * a tilted picture, which is the other thing the card would have forced.
 *
 * The board places it, because the board is the only thing that knows the
 * camera; this component only draws the fields.
 */

import { IMAGE_CAPTION_HEIGHT } from './tuning'

/** How wide the caption is, in screen px. Fixed: it is a form, not a photo caption. */
export const CAPTION_WIDTH = 240

export interface ImageCaptionProps {
  title: string
  description: string
  /** Top-left of the caption, in the board's own box coordinates. */
  x: number
  y: number
  onTitle: (next: string) => void
  onDescription: (next: string) => void
}

export function ImageCaption({
  title,
  description,
  x,
  y,
  onTitle,
  onDescription,
}: ImageCaptionProps) {
  return (
    <div
      className="image-caption absolute"
      data-testid="image-caption"
      style={{ left: x, top: y, width: CAPTION_WIDTH, height: IMAGE_CAPTION_HEIGHT }}
      // The caption floats over the board: a press in a field is a press in a
      // field, not the start of a pan or a marquee.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <input
        className="image-caption-title"
        value={title}
        onChange={(event) => onTitle(event.target.value)}
        placeholder="Untitled picture"
        aria-label="Picture title"
        spellCheck={false}
      />
      <textarea
        className="image-caption-body"
        value={description}
        onChange={(event) => onDescription(event.target.value)}
        placeholder="What is this a picture of?"
        aria-label="Picture description"
        spellCheck={false}
      />
    </div>
  )
}
