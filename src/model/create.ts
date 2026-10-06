// Ids are minted client-side: writes are idempotent upserts keyed on the id, so a retry cannot duplicate.

import type { TextAnchor } from "../anchors/types";
import type { EdgeStyle } from "../board/edges";
import type { Point } from "../board/yarn";
import {
  DEFAULT_ARTICLE_OPTIONS,
  type ArticleOptions,
} from "./article-options";
import {
  IMAGE_SIZE,
  NOTE_FONT_DEFAULT,
  NOTE_FONT_SCALE_DEFAULT,
  NOTE_SIZE,
  seededTilt,
} from "./kinds";
import type {
  AnchoredPin,
  ArticleEntity,
  FreePin,
  ImageEntity,
  ImageFit,
  ItemStatus,
  NoteEntity,
  NoteFont,
  NoteStyle,
  Visibility,
} from "./types";

export interface EntitySeed {
  /** Adopt this id rather than minting one; a seeded board passes ids other rows point at. */
  id?: string;
  title?: string;
  bodyMd?: string;
  color?: string;
  visibility?: Visibility;
  status?: ItemStatus;
  dateLabel?: string;
  occurredAt?: number;
  nudge?: Point;
  zIndex?: number;
  createdBy?: string;
}

function base(seed: EntitySeed): {
  id: string;
  bodyMd: string;
  visibility: Visibility;
  status: ItemStatus;
  dateInherit: boolean;
  nudge: Point;
  zIndex: number;
  version: number;
  createdAt: number;
  updatedAt: number;
} & EntitySeed {
  const now = Date.now();
  return {
    ...seed,
    id: seed.id ?? crypto.randomUUID(),
    bodyMd: seed.bodyMd ?? "",
    visibility: seed.visibility ?? "shared",
    status: seed.status ?? "theory",
    // A group's date flows down to its members unless one sets its own.
    dateInherit: true,
    nudge: seed.nudge ?? { x: 0, y: 0 },
    zIndex: seed.zIndex ?? 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function newAnchoredPin(
  articleId: string,
  anchor: TextAnchor,
  seed: EntitySeed = {},
): AnchoredPin {
  return { ...base(seed), kind: "pin", articleId, anchor };
}

export function newFreePin(board: Point, seed: EntitySeed = {}): FreePin {
  return { ...base(seed), kind: "pin", board };
}

export function newNote(
  board: Point,
  seed: EntitySeed & {
    fontScale?: number;
    style?: NoteStyle;
    font?: NoteFont;
    tilt?: number;
  } = {},
): NoteEntity {
  const { fontScale, style, font, tilt, ...rest } = seed;
  const common = base(rest);
  return {
    ...common,
    kind: "note",
    board,
    ...NOTE_SIZE,
    fontScale: fontScale ?? NOTE_FONT_SCALE_DEFAULT,
    style: style ?? "plain",
    font: font ?? NOTE_FONT_DEFAULT,
    // From the id, so the note keeps leaning the way it did when it was stuck down.
    tilt: tilt ?? seededTilt(common.id),
  };
}

export function newArticle(
  board: Point,
  bodyMd: string,
  title: string,
  options: ArticleOptions = DEFAULT_ARTICLE_OPTIONS,
  seed: EntitySeed = {},
): ArticleEntity {
  return {
    ...base({ ...seed, bodyMd, title }),
    kind: "article",
    board,
    rotation: 0,
    options,
  };
}

/** Any 31-bit value; successive calls must differ, as the border generator is deterministic. */
export function freshEdgeSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export const MAX_IMAGE_EDGE = 420;

export function imageFootprint(
  pixelWidth: number,
  pixelHeight: number,
): { width: number; height: number } {
  const longest = Math.max(pixelWidth, pixelHeight);
  // Both dimensions, not just the longest: a negative width with a sane height passes a max-only check.
  const usable =
    Number.isFinite(pixelWidth) &&
    Number.isFinite(pixelHeight) &&
    pixelWidth > 0 &&
    pixelHeight > 0;
  if (!usable) {
    return { width: IMAGE_SIZE.width, height: IMAGE_SIZE.height };
  }
  const scale = longest > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longest : 1;
  return {
    width: Math.round(pixelWidth * scale),
    height: Math.round(pixelHeight * scale),
  };
}

export function newImage(
  board: Point,
  src: string,
  size: { width: number; height: number },
  seed: EntitySeed & { alt?: string; fit?: ImageFit; edge?: EdgeStyle } = {},
): ImageEntity {
  const { alt, fit, edge, ...rest } = seed;
  return {
    ...base(rest),
    kind: "image",
    board,
    src,
    width: size.width,
    height: size.height,
    alt,
    fit: fit ?? "cover",
    rotation: 0,
    edge: edge ?? "clean",
    edgeSeed: freshEdgeSeed(),
  };
}
