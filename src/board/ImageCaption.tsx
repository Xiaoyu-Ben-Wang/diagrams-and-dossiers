import { IMAGE_CAPTION_HEIGHT } from './tuning'

export const CAPTION_WIDTH = 240

export interface ImageCaptionProps {
  title: string
  description: string
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
      // A press in a field is not the start of a pan or a marquee.
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
