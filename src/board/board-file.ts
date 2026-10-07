import type { TextAnchor } from "../anchors/types";
import { parseArticleOptions } from "../model/article-options";
import {
  DATE_PRECISIONS,
  ENTITY_KINDS,
  IMAGE_FITS,
  ITEM_STATUSES,
  NOTE_FONTS,
  NOTE_STYLES,
  STRING_STYLES,
  VISIBILITIES,
  type BoardEntity,
  type DatePrecision,
  type ImageFit,
  type ItemStatus,
  type NoteFont,
  type NoteStyle,
  type StringLink,
  type StringStyle,
  type Visibility,
} from "../model/types";
import { EDGE_STYLES, type EdgeStyle } from "./edges";
import {
  NOTE_FONT_DEFAULT,
  NOTE_FONT_SCALE_DEFAULT,
  NOTE_FONT_SCALE_MAX,
  NOTE_FONT_SCALE_MIN,
  seededTilt,
} from "../model/kinds";
import type { BoardState } from "./store";
import { DEFAULT_SLACK, LABEL_AT_MIDDLE, YARN_COLOR } from "./yarn";
import type { Point } from "./yarn";

export const BOARD_FILE_FORMAT = "diagrams-and-dossiers.board";

/** Bump only when an older reader would misunderstand the file, not merely lose a field. */
export const BOARD_FILE_VERSION = 1;

export const DEFAULT_BOARD_FILE_NAME = "case-board.json";

export interface BoardFile {
  format: typeof BOARD_FILE_FORMAT;
  version: number;
  /** Ignored on the way in. */
  exportedAt: string;
  board: BoardState;
}

export type BoardFileResult =
  { ok: true; board: BoardState } | { ok: false; reason: string };

export function boardFileName(board: BoardState): string {
  const article = board.entities.find((entity) => entity.kind === "article");
  const slug = (article?.title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug ? `${slug}.json` : DEFAULT_BOARD_FILE_NAME;
}

/** `FileReader`, not `Blob.text()`: jsdom does not implement `Blob.text()`. */
export function readBoardFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () =>
      reject(reader.error ?? new Error("the file could not be read"));
    reader.readAsText(file);
  });
}

export function serializeBoard(
  board: BoardState,
  now: number = Date.now(),
): string {
  const file: BoardFile = {
    format: BOARD_FILE_FORMAT,
    version: BOARD_FILE_VERSION,
    exportedAt: new Date(now).toISOString(),
    board,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Never throws: a bad file comes back as a reason for the caller to show. */
export function parseBoardFile(text: string): BoardFileResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "That file is not JSON." };
  }

  try {
    const file = asRecord(raw, "the file");
    if (file.format !== BOARD_FILE_FORMAT) {
      return { ok: false, reason: "That is JSON, but it is not a case board." };
    }
    const version = number(file.version, "version");
    if (version !== BOARD_FILE_VERSION) {
      return {
        ok: false,
        reason: `That board was written in format version ${version}, and this build reads version ${BOARD_FILE_VERSION}.`,
      };
    }

    const board = asRecord(file.board, "board");
    const rawEntities = array(board.entities, "board.entities");
    const entities = rawEntities.map((entity, at) =>
      parseEntity(entity, `entities[${at}]`),
    );

    const ids = new Set(entities.map((entity) => entity.id));
    if (ids.size !== entities.length) {
      return { ok: false, reason: "Two things in that file share an id." };
    }

    const strings = array(board.strings, "board.strings").map((link, at) => {
      const parsed = parseString(link, `strings[${at}]`);
      // A string to something not in the file would be drawn to the origin.
      if (!ids.has(parsed.from) || !ids.has(parsed.to)) {
        throw new Error(
          `strings[${at}] is tied to something that is not in the file`,
        );
      }
      return parsed;
    });

    return { ok: true, board: { entities, strings } };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? error.message
          : "That board could not be read.",
    };
  }
}

// Field readers throw with the field's path; the message is what the person sees.
function fail(where: string, expected: string): never {
  throw new Error(`That board could not be read: ${where} is not ${expected}.`);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(where, "an object");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(where, "a list");
  return value;
}

function number(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(where, "a number");
  return value;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string") fail(where, "text");
  return value;
}

function optionalText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Both names this paper has had; a board written under either keeps it. */
function noteStyle(value: unknown): NoteStyle {
  if (value === "dog-eared" || value === "crumpled") return "torn";
  return oneOf<NoteStyle>(value, NOTE_STYLES, "plain");
}

function point(value: unknown, where: string): Point {
  const raw = asRecord(value, where);
  return { x: number(raw.x, `${where}.x`), y: number(raw.y, `${where}.y`) };
}

function record(value: unknown, where: string): Record<string, unknown> {
  return asRecord(value, where);
}

function commonFields(raw: Record<string, unknown>, where: string) {
  return {
    id: text(raw.id, `${where}.id`),
    title: typeof raw.title === "string" ? raw.title : undefined,
    bodyMd: optionalText(raw.bodyMd, ""),
    color: typeof raw.color === "string" ? raw.color : undefined,
    visibility: oneOf<Visibility>(raw.visibility, VISIBILITIES, "shared"),
    revealAt: optionalNumber(raw.revealAt),
    status: oneOf<ItemStatus>(raw.status, ITEM_STATUSES, "theory"),
    dateLabel: typeof raw.dateLabel === "string" ? raw.dateLabel : undefined,
    occurredAt: optionalNumber(raw.occurredAt),
    datePrecision: DATE_PRECISIONS.includes(raw.datePrecision as DatePrecision)
      ? (raw.datePrecision as DatePrecision)
      : undefined,
    dateInherit: raw.dateInherit !== false,
    nudge:
      raw.nudge === undefined
        ? { x: 0, y: 0 }
        : point(raw.nudge, `${where}.nudge`),
    zIndex: optionalNumber(raw.zIndex) ?? 0,
    version: optionalNumber(raw.version) ?? 1,
    createdBy: typeof raw.createdBy === "string" ? raw.createdBy : undefined,
    createdAt: optionalNumber(raw.createdAt) ?? 0,
    updatedAt: optionalNumber(raw.updatedAt) ?? 0,
  };
}

// Guards against an unbounded data URI handing the tab a gigabyte of base64.
const MAX_IMAGE_SRC = 8 * 1024 * 1024;

// `javascript:` is inert in an <img> today, but not a reason to write it into the board.
const SAFE_IMAGE_SRC = /^(?:data:image\/|blob:|https?:\/\/)/i;

function clampFontScale(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value))
    return NOTE_FONT_SCALE_DEFAULT;
  return Math.min(NOTE_FONT_SCALE_MAX, Math.max(NOTE_FONT_SCALE_MIN, value));
}

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

function parseEntity(value: unknown, where: string): BoardEntity {
  const raw = record(value, where);
  const kind = text(raw.kind, `${where}.kind`);
  if (!ENTITY_KINDS.includes(kind as (typeof ENTITY_KINDS)[number])) {
    fail(`${where}.kind`, `one of ${ENTITY_KINDS.join(", ")}`);
  }
  const base = commonFields(raw, where);

  switch (kind) {
    case "pin":
      return "anchor" in raw
        ? {
            ...base,
            kind: "pin",
            articleId: text(raw.articleId, `${where}.articleId`),
            anchor: parseAnchor(raw.anchor, `${where}.anchor`),
          }
        : { ...base, kind: "pin", board: point(raw.board, `${where}.board`) };

    case "note":
      return {
        ...base,
        kind: "note",
        board: point(raw.board, `${where}.board`),
        width: number(raw.width, `${where}.width`),
        height: number(raw.height, `${where}.height`),
        fontScale: clampFontScale(optionalNumber(raw.fontScale)),
        style: noteStyle(raw.style),
        font: oneOf<NoteFont>(raw.font, NOTE_FONTS, NOTE_FONT_DEFAULT),
        // A file written before the angle was stored gets the one its id implies,
        // rather than squaring up a board that was never square.
        tilt: optionalNumber(raw.tilt) ?? seededTilt(base.id),
      };

    case "article":
      return {
        ...base,
        kind: "article",
        board: point(raw.board, `${where}.board`),
        rotation: optionalNumber(raw.rotation) ?? 0,
        options: parseArticleOptions(raw.options),
      };

    case "image": {
      const src = text(raw.src, `${where}.src`);
      if (!SAFE_IMAGE_SRC.test(src)) {
        fail(`${where}.src`, "an http(s), blob: or data:image/ URL");
      }
      if (src.length > MAX_IMAGE_SRC) {
        fail(`${where}.src`, `shorter than ${MAX_IMAGE_SRC} characters`);
      }
      const fit = oneOf<ImageFit>(raw.fit, IMAGE_FITS, "cover");
      const edge = EDGE_STYLES.includes(raw.edge as EdgeStyle)
        ? (raw.edge as EdgeStyle)
        : "clean";
      return {
        ...base,
        kind: "image",
        board: point(raw.board, `${where}.board`),
        src,
        alt: typeof raw.alt === "string" ? raw.alt : undefined,
        width: number(raw.width, `${where}.width`),
        height: number(raw.height, `${where}.height`),
        fit,
        rotation: optionalNumber(raw.rotation) ?? 0,
        edge,
        edgeSeed: optionalNumber(raw.edgeSeed) ?? 0,
        ...(raw.frame === "polaroid" ? { frame: "polaroid" as const } : {}),
      };
    }
  }
  // Unreachable: kind was checked above. Written out so a new kind is a compile error here.
  throw new Error(`${where}.kind is one of the entity kinds but has no reader`);
}

function parseString(value: unknown, where: string): StringLink {
  const raw = record(value, where);
  return {
    id: text(raw.id, `${where}.id`),
    from: text(raw.from, `${where}.from`),
    to: text(raw.to, `${where}.to`),
    slack: Math.min(1, Math.max(0, optionalNumber(raw.slack) ?? DEFAULT_SLACK)),
    color: optionalText(raw.color, YARN_COLOR),
    style: oneOf<StringStyle>(raw.style, STRING_STYLES, "solid"),
    label:
      typeof raw.label === "string" && raw.label !== "" ? raw.label : undefined,
    labelAt: Math.min(
      1,
      Math.max(0, optionalNumber(raw.labelAt) ?? LABEL_AT_MIDDLE),
    ),
    visibility: oneOf<Visibility>(raw.visibility, VISIBILITIES, "shared"),
  };
}
