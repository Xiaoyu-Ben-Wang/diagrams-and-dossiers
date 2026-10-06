// Placement is carried by the kind: `AnchoredPin` holds an anchor and no `board`, and the
// kinds with a `board` hold no anchor, mirroring the schema's anchor-XOR-board CHECK.

import type { AnchorRect } from "../anchors/dom";
import type { TextAnchor } from "../anchors/types";
import type { EdgeStyle } from "../board/edges";
import type { Rect } from "../board/camera";
import type { Point } from "../board/yarn";
import type { ArticleOptions } from "./article-options";

export const ENTITY_KINDS = ["pin", "note", "article", "image"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** `dm` is the DM-only layer. */
export const VISIBILITIES = ["shared", "dm"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Theory lifecycle; unrelated to anchor resolution. */
export const ITEM_STATUSES = ["theory", "confirmed", "disproven"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const DATE_PRECISIONS = ["year", "month", "day", "exact"] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

/** How a string is drawn; only `solid` is produced today. */
export const STRING_STYLES = ["solid", "dashed", "double"] as const;
export type StringStyle = (typeof STRING_STYLES)[number];

/** The paper a note is drawn on. Each is a CSS rule keyed on `data-note-style`. */
export const NOTE_STYLES = [
  "plain",
  "ruled",
  "grid",
  "crumpled",
  "taped",
] as const;
export type NoteStyle = (typeof NOTE_STYLES)[number];

/**
 * The hand a note is written in: the system sans, both typewriters, a round hand
 * and a heavy scrawl. Each is a CSS rule keyed on `data-note-font`, and the id is
 * the face rather than the role (`typewriter`, `scrawl`), so dropping a face the
 * set is finished with means deleting an id rather than repointing one. The
 * licence for each is beside the file it names.
 */
export const NOTE_FONTS = [
  "system",
  "special-elite",
  "courier-prime",
  "kalam",
  "rock-salt",
] as const;
export type NoteFont = (typeof NOTE_FONTS)[number];

export const ROLES = ["viewer", "editor", "dm", "owner"] as const;
export type Role = (typeof ROLES)[number];

/** Degrees of image rotation either way. */
export const MAX_IMAGE_ROTATION = 45;
export const IMAGE_FITS = ["cover", "contain"] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];

/** `nudge` is a manual offset for an entity whose real position is derived, not a column. */
export interface EntityBase {
  id: string;
  title?: string;
  bodyMd: string;
  color?: string;
  visibility: Visibility;
  revealAt?: number;
  status: ItemStatus;
  dateLabel?: string;
  occurredAt?: number;
  datePrecision?: DatePrecision;
  dateInherit: boolean;
  nudge: Point;
  zIndex: number;
  version: number;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AnchoredPin extends EntityBase {
  kind: "pin";
  articleId: string;
  anchor: TextAnchor;
}

export interface FreePin extends EntityBase {
  kind: "pin";
  board: Point;
}

export type PinEntity = AnchoredPin | FreePin;

export interface NoteEntity extends EntityBase {
  kind: "note";
  board: Point;
  /** Footprint in board px; stored because a note is resized by dragging. */
  width: number;
  height: number;
  /** Font size as a multiple of `NOTE_FONT_SIZE`. */
  fontScale: number;
  style: NoteStyle;
  font: NoteFont;
  /** Degrees the note leans by, seeded at creation; within ±`NOTE_TILT_MAX`. */
  tilt: number;
}

export interface ArticleEntity extends EntityBase {
  kind: "article";
  board: Point;
  /** Degrees of swing about the top-centre tab, not the box; within ±`MAX_TILT_DEG`. */
  rotation: number;
  options: ArticleOptions;
}

export interface ImageEntity extends EntityBase {
  kind: "image";
  board: Point;
  src: string;
  alt?: string;
  /** On-board footprint in board px, not the file's pixel size. */
  width: number;
  height: number;
  fit: ImageFit;
  /** Degrees of swing about the top-centre pin; within ±`MAX_TILT_DEG`. */
  rotation: number;
  /** How the border is damaged (torn, burnt, …). */
  edge: EdgeStyle;
  /** Seed the deterministic damage generator runs on; re-rolled when the picture is picked up. */
  edgeSeed: number;
}

export type BoardEntity = PinEntity | NoteEntity | ArticleEntity | ImageEntity;

export type PlacedEntity = FreePin | NoteEntity | ArticleEntity | ImageEntity;

export function isPlaced(entity: BoardEntity): entity is PlacedEntity {
  return entity.kind !== "pin" || "board" in entity;
}

export function isPin(entity: BoardEntity): entity is PinEntity {
  return entity.kind === "pin";
}

export function isAnchoredPin(entity: BoardEntity): entity is AnchoredPin {
  return entity.kind === "pin" && "anchor" in entity;
}

/** A strand of yarn; `from`/`to` are entity ids of any kind. */
export interface StringLink {
  id: string;
  from: string;
  to: string;
  /** Rope length as a fraction of the gap. */
  slack: number;
  color: string;
  style: StringStyle;
  /** A tag describing what the string means, or none. */
  label?: string;
  /** Where along the string the tag hangs: 0 at `from`, 1 at `to`. */
  labelAt: number;
  visibility: Visibility;
}

/** Schema only; no UI yet. */
export interface Group {
  id: string;
  name: string;
  color: string;
  visibility: Visibility;
  dateLabel?: string;
  occurredAt?: number;
  datePrecision?: DatePrecision;
  memberIds: string[];
}

export interface EntityContext {
  /** Maps a point in an article's own space to board space, turning it with the article. */
  articleToBoard(articleId: string, local: Point): Point | null;
  /** The resolved rect of a pin's anchor, in that article's space. */
  anchorRect(entityId: string): AnchorRect | null;
  /** Measured footprint; a page sizes itself to its body. */
  articleSize(articleId: string): { width: number; height: number } | null;
}

/** `nowhere` is a pin whose anchor no longer resolves. */
export type Placement =
  | { at: "board"; point: Point }
  | { at: "article"; articleId: string; rect: AnchorRect }
  | { at: "nowhere" };

export type { Rect };
