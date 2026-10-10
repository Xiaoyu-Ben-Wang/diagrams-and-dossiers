/**
 * Between a `BoardEntity` and a row of `items`/`strings`.
 *
 * The schema is the client's servant here, not the other way round: `options`
 * has no CHECK on its keys and the client parser supplies defaults, so a row
 * written by an older client reads under today's defaults. Reading is therefore
 * lenient everywhere except identity — a row without an id or a known kind is
 * not something to paper over.
 *
 * `nudge` is deliberately not carried: it is a local correction to a derived
 * position, so it stays on the machine that made it.
 */
import type { TextAnchor } from "../anchors/types";
import { parseArticleOptions } from "../model/article-options";
import { fieldReaders } from "../model/fields";
import { NOTE_FONT_DEFAULT } from "../model/kinds";
import {
  DATE_PRECISIONS,
  IMAGE_FITS,
  IMAGE_FRAMES,
  ITEM_STATUSES,
  NOTE_FONTS,
  NOTE_STYLES,
  STRING_STYLES,
  VISIBILITIES,
  type BoardEntity,
  type DatePrecision,
  type ImageFit,
  type ImageFrame,
  type ItemStatus,
  type NoteFont,
  type NoteStyle,
  type StringLink,
  type StringStyle,
  type Visibility,
} from "../model/types";
import { EDGE_STYLES, type EdgeStyle } from "../board/edges";
import { LABEL_AT_MIDDLE } from "../board/yarn";
import type { Point } from "../board/yarn";

const {
  fail,
  asRecord,
  number,
  text,
  optionalText,
  optionalNumber,
  oneOf,
  record,
} = fieldReaders("That change could not be read");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A local id has to survive the trip: Postgres rejects anything else as 22P02. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export interface ItemRow {
  id: string;
  board_id: string;
  kind: string;
  title: string | null;
  body_md: string;
  color: string | null;
  visibility: string;
  reveal_at: string | null;
  board_x: number | null;
  board_y: number | null;
  article_id: string | null;
  anchor: unknown;
  status: string;
  date_label: string | null;
  occurred_at: string | null;
  date_precision: string | null;
  date_inherit: boolean;
  src: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
  fit: string;
  rotation: number;
  edge: string;
  edge_seed: number;
  options: unknown;
  style: string;
  font_scale: number;
  tilt: number;
  font: string;
  frame: string | null;
  z_index: number;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StringRow {
  id: string;
  board_id: string;
  from_item: string;
  to_item: string;
  style: string;
  label: string | null;
  slack: number;
  label_at: number;
  visibility: string;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * What a write sends. `version` is absent on purpose: the trigger owns that
 * column, so it is only ever a predicate. `created_by` is absent too — it has to
 * equal the caller on insert and the trigger rejects a later change, so the
 * outbox supplies it once rather than the mapper carrying it on every write.
 */
export type ItemWrite = Omit<
  ItemRow,
  "version" | "created_at" | "updated_at" | "created_by"
>;
export type StringWrite = Omit<
  StringRow,
  "version" | "created_at" | "updated_at" | "created_by"
>;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function millis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const at = Date.parse(value);
    return Number.isNaN(at) ? undefined : at;
  }
  return undefined;
}

function optional<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Mirrors `parseAnchor` in `board-file.ts`; the shape is fixed by `TextAnchor`. */
function parseAnchor(value: unknown, where: string): TextAnchor {
  const raw = record(value, where);
  return {
    quote: text(raw.quote, `${where}.quote`),
    prefix: optionalText(raw.prefix, ""),
    suffix: optionalText(raw.suffix, ""),
    startOffset: number(raw.startOffset, `${where}.startOffset`),
    endOffset: number(raw.endOffset, `${where}.endOffset`),
  };
}

function pointFrom(raw: Record<string, unknown>, where: string): Point {
  return {
    x: number(raw.board_x, `${where}.board_x`),
    y: number(raw.board_y, `${where}.board_y`),
  };
}

function baseFields(raw: Record<string, unknown>, where: string) {
  return {
    id: text(raw.id, `${where}.id`),
    title: optionalString(raw.title),
    bodyMd: optionalText(raw.body_md, ""),
    color: optionalString(raw.color),
    visibility: oneOf<Visibility>(raw.visibility, VISIBILITIES, "shared"),
    revealAt: millis(raw.reveal_at),
    status: oneOf<ItemStatus>(raw.status, ITEM_STATUSES, "theory"),
    dateLabel: optionalString(raw.date_label),
    occurredAt: millis(raw.occurred_at),
    datePrecision: optional<DatePrecision>(raw.date_precision, DATE_PRECISIONS),
    dateInherit: raw.date_inherit !== false,
    nudge: { x: 0, y: 0 },
    zIndex: optionalNumber(raw.z_index) ?? 0,
    version: optionalNumber(raw.version) ?? 1,
    createdBy: optionalString(raw.created_by),
    createdAt: millis(raw.created_at) ?? 0,
    updatedAt: millis(raw.updated_at) ?? 0,
  };
}

export function rowToEntity(value: unknown): BoardEntity {
  const raw = asRecord(value, "row");
  const kind = text(raw.kind, "row.kind");
  const where = `item ${text(raw.id, "row.id")}`;
  const base = baseFields(raw, where);

  switch (kind) {
    case "pin":
      return raw.article_id === null || raw.article_id === undefined
        ? { ...base, kind: "pin", board: pointFrom(raw, where) }
        : {
            ...base,
            kind: "pin",
            articleId: text(raw.article_id, "row.article_id"),
            anchor: parseAnchor(raw.anchor, `${where}.anchor`),
          };
    case "note":
      return {
        ...base,
        kind: "note",
        board: pointFrom(raw, where),
        width: number(raw.width, "row.width"),
        height: number(raw.height, "row.height"),
        fontScale: optionalNumber(raw.font_scale) ?? 1,
        style: oneOf<NoteStyle>(raw.style, NOTE_STYLES, "plain"),
        font: oneOf<NoteFont>(raw.font, NOTE_FONTS, NOTE_FONT_DEFAULT),
        tilt: optionalNumber(raw.tilt) ?? 0,
      };
    case "article":
      return {
        ...base,
        kind: "article",
        board: pointFrom(raw, where),
        rotation: optionalNumber(raw.rotation) ?? 0,
        options: parseArticleOptions(raw.options),
      };
    case "image":
      return {
        ...base,
        kind: "image",
        board: pointFrom(raw, where),
        src: text(raw.src, "row.src"),
        alt: optionalString(raw.alt),
        width: number(raw.width, "row.width"),
        height: number(raw.height, "row.height"),
        fit: oneOf<ImageFit>(raw.fit, IMAGE_FITS, "cover"),
        rotation: optionalNumber(raw.rotation) ?? 0,
        edge: oneOf<EdgeStyle>(raw.edge, EDGE_STYLES, "clean"),
        edgeSeed: optionalNumber(raw.edge_seed) ?? 0,
        // The column allows null or 'polaroid'; "none" and absent are one thing.
        frame:
          oneOf<ImageFrame>(raw.frame, IMAGE_FRAMES, "none") === "none"
            ? undefined
            : "polaroid",
      };
    default:
      return fail("row.kind", "one of pin, note, article, image");
  }
}

export function rowToString(value: unknown): StringLink {
  const raw = asRecord(value, "row");
  const id = text(raw.id, "row.id");
  const where = `string ${id}`;
  const slack = number(raw.slack, `${where}.slack`);
  const labelAt = optionalNumber(raw.label_at) ?? LABEL_AT_MIDDLE;

  return {
    id,
    from: text(raw.from_item, `${where}.from_item`),
    to: text(raw.to_item, `${where}.to_item`),
    slack: Math.min(1, Math.max(0, slack)),
    style: oneOf<StringStyle>(raw.style, STRING_STYLES, "solid"),
    label: optionalString(raw.label),
    labelAt: Math.min(1, Math.max(0, labelAt)),
    visibility: oneOf<Visibility>(raw.visibility, VISIBILITIES, "shared"),
    version: optionalNumber(raw.version) ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function iso(at: number | undefined): string | null {
  return at === undefined ? null : new Date(at).toISOString();
}

function requireUuid(id: string, what: string): string {
  if (!isUuid(id)) fail(`${what} id`, "a uuid");
  return id;
}

export function entityToRow(entity: BoardEntity, boardId: string): ItemWrite {
  requireUuid(entity.id, `${entity.kind}`);
  const placed = "board" in entity ? entity.board : undefined;

  const row: ItemWrite = {
    id: entity.id,
    board_id: boardId,
    kind: entity.kind,
    title: entity.title ?? null,
    body_md: entity.bodyMd,
    color: entity.color ?? null,
    visibility: entity.visibility,
    reveal_at: iso(entity.revealAt),
    board_x: placed?.x ?? null,
    board_y: placed?.y ?? null,
    article_id: null,
    anchor: null,
    status: entity.status,
    date_label: entity.dateLabel ?? null,
    occurred_at: iso(entity.occurredAt),
    date_precision: entity.datePrecision ?? null,
    date_inherit: entity.dateInherit,
    src: null,
    alt: null,
    width: null,
    height: null,
    fit: "cover",
    rotation: 0,
    edge: "clean",
    edge_seed: 0,
    options: {},
    style: "plain",
    font_scale: 1,
    tilt: 0,
    font: NOTE_FONT_DEFAULT,
    frame: null,
    z_index: entity.zIndex,
  };

  switch (entity.kind) {
    case "pin":
      if ("anchor" in entity) {
        row.article_id = requireUuid(entity.articleId, "article");
        row.anchor = entity.anchor;
      }
      return row;
    case "note":
      row.width = entity.width;
      row.height = entity.height;
      row.font_scale = entity.fontScale;
      row.style = entity.style;
      row.font = entity.font;
      row.tilt = entity.tilt;
      return row;
    case "article":
      row.rotation = entity.rotation;
      row.options = entity.options;
      return row;
    case "image":
      row.src = entity.src;
      row.alt = entity.alt ?? null;
      row.width = entity.width;
      row.height = entity.height;
      row.fit = entity.fit;
      row.rotation = entity.rotation;
      row.edge = entity.edge;
      row.edge_seed = entity.edgeSeed;
      row.frame = entity.frame === "polaroid" ? "polaroid" : null;
      return row;
  }
}

export function stringToRow(link: StringLink, boardId: string): StringWrite {
  requireUuid(link.id, "string");
  return {
    id: link.id,
    board_id: boardId,
    from_item: requireUuid(link.from, "string from"),
    to_item: requireUuid(link.to, "string to"),
    style: link.style,
    label: link.label ?? null,
    slack: link.slack,
    label_at: link.labelAt,
    visibility: link.visibility,
  };
}
