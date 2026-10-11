// Where a fraction of a picture lands on the board, and back. The only place this maths
// lives: the kind descriptor, the view, the drop hit-test and the drag all come here.

import type { Rect } from "../board/camera";
import { rotateAbout } from "../board/pivot";
import type { Point } from "../board/yarn";
import type { ImageEntity, Spot } from "./types";

/** A polaroid's border, in board px; the top clears the tack before the title line. */
export const POLAROID_INSETS = { top: 40, side: 10, bottom: 58 } as const;

/**
 * The photo inside the card, in the card's own coordinates. A polaroid's border lives *inside*
 * `width`/`height`, so a fraction of the card is not a fraction of the photo — a mark kept as a
 * fraction of the card slides by the border width when the frame is added or removed.
 */
export function imagePhotoBox(image: ImageEntity): Rect {
  if (image.frame !== "polaroid") {
    return { x: 0, y: 0, width: image.width, height: image.height };
  }
  const { top, side, bottom } = POLAROID_INSETS;
  return {
    x: side,
    y: top,
    width: Math.max(0, image.width - 2 * side),
    height: Math.max(0, image.height - top - bottom),
  };
}

/** The card's top-centre, the point it swings about. */
export function imagePivot(image: ImageEntity): Point {
  return { x: image.board.x + image.width / 2, y: image.board.y };
}

export function clampSpot(spot: Spot): Spot {
  return { u: clamp01(spot.u), v: clamp01(spot.v) };
}

function clamp01(value: number): number {
  // jsdom reports computed lengths as empty strings, so a NaN can reach here from a stale
  // measurement; a spot is never allowed to become one.
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** The board point a spot lands on, turning with the card. Null for a degenerate photo box. */
export function imageMarkPoint(image: ImageEntity, spot: Spot): Point | null {
  const photo = imagePhotoBox(image);
  if (photo.width <= 0 || photo.height <= 0) return null;
  return rotateAbout(
    imagePivot(image),
    {
      x: image.board.x + photo.x + spot.u * photo.width,
      y: image.board.y + photo.y + spot.v * photo.height,
    },
    image.rotation,
  );
}

/**
 * The spot a board point names. Deliberately unclamped: a drag reads this so the mark follows
 * the pointer off the photo, and only the drop decides whether it stayed.
 */
export function imageSpot(image: ImageEntity, board: Point): Spot | null {
  const photo = imagePhotoBox(image);
  if (photo.width <= 0 || photo.height <= 0) return null;
  const local = cardLocal(image, board);
  return {
    u: (local.x - photo.x) / photo.width,
    v: (local.y - photo.y) / photo.height,
  };
}

/** The spot for a point on the card, clamped to the photo; null for a point off the card. */
export function imageSpotHit(image: ImageEntity, board: Point): Spot | null {
  const local = cardLocal(image, board);
  if (local.x < 0 || local.x > image.width) return null;
  if (local.y < 0 || local.y > image.height) return null;
  const spot = imageSpot(image, board);
  return spot ? clampSpot(spot) : null;
}

/** A board point in the card's own coordinates, un-turned about the pivot. */
function cardLocal(image: ImageEntity, board: Point): Point {
  const turned = rotateAbout(imagePivot(image), board, -image.rotation);
  return { x: turned.x - image.board.x, y: turned.y - image.board.y };
}
