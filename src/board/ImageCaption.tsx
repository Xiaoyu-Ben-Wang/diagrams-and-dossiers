import { TitleField } from "./TitleField";
import { IMAGE_CAPTION_HEIGHT } from "./tuning";

export const CAPTION_WIDTH = 240;

export interface ImageCaptionProps {
  /** The picture this is the caption of, so the board knows what a keypress in it is editing. */
  entityId: string;
  title: string;
  description: string;
  x: number;
  y: number;
  onTitle: (next: string) => void;
  onDescription: (next: string) => void;
  /** Somebody else has it; still readable, just not writable. */
  locked?: boolean;
}

export function ImageCaption({
  entityId,
  title,
  description,
  x,
  y,
  onTitle,
  onDescription,
  locked = false,
}: ImageCaptionProps) {
  return (
    <div
      className="image-caption absolute"
      data-entity-id={entityId}
      data-testid="image-caption"
      style={{
        left: x,
        top: y,
        width: CAPTION_WIDTH,
        height: IMAGE_CAPTION_HEIGHT,
      }}
      // A press in a field is not the start of a pan or a marquee.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <TitleField
        className="image-caption-title"
        value={title}
        onCommit={onTitle}
        placeholder="Untitled picture"
        label="Picture title"
        locked={locked}
      />
      <textarea
        className="image-caption-body"
        value={description}
        readOnly={locked}
        onChange={(event) => onDescription(event.target.value)}
        placeholder={locked ? "" : "What is this a picture of?"}
        aria-label={locked ? "Picture description (locked)" : "Picture description"}
        spellCheck={false}
      />
    </div>
  );
}
