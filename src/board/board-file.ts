/**
 * A board as a file.
 *
 * The board lives in memory and nowhere else, so this is how it survives being
 * closed: everything on it, as JSON, and a reader that can put it back. It is
 * also the shape the server will eventually speak, which is why the envelope
 * carries a format marker and a version rather than being a bare `BoardState` —
 * a file that says what it is can be refused by name when it is not that thing,
 * and a bare array cannot.
 *
 * ## The parse refuses rather than repairs
 *
 * Everything else in this codebase that reads untyped input — `parseArticleOptions`,
 * `parsePreferences` — falls back per field, so one bad value costs only itself.
 * This does not, and the difference is deliberate: those read a blob the app
 * itself wrote, where a bad field means a bug, and this reads a file somebody
 * may have edited, truncated, or written by hand. A board that half-loads is
 * worse than one that refuses, because a case file missing three of its notes
 * looks exactly like a case file that never had them. So the first thing that
 * does not check out stops the load and the person is told what it was.
 *
 * The validation is therefore structural rather than exhaustive. It insists on
 * the things whose absence would leave the board drawing to nowhere — a kind,
 * a placement, an anchor, an image source — and lets the cosmetic fields fall
 * back to their defaults, because a missing `zIndex` is not a reason to refuse
 * somebody's notes.
 *
 * ## Image sources are checked, not trusted
 *
 * An imported `src` goes straight into an `<img>`. `javascript:` URLs are inert
 * there in every current browser, but "the browser happens not to run this" is
 * not a reason to write it into the board — and an unbounded data URI is a way
 * to hand the tab a gigabyte of base64. Both are refused by name.
 */

import type { TextAnchor } from '../anchors/types'
import { parseArticleOptions } from '../model/article-options'
import {
  DATE_PRECISIONS,
  ENTITY_KINDS,
  IMAGE_FITS,
  ITEM_STATUSES,
  STRING_STYLES,
  VISIBILITIES,
  type BoardEntity,
  type DatePrecision,
  type ImageFit,
  type ItemStatus,
  type StringLink,
  type StringStyle,
  type Visibility,
} from '../model/types'
import { EDGE_STYLES, type EdgeStyle } from './edges'
import { NOTE_FONT_SCALE_DEFAULT, NOTE_FONT_SCALE_MAX, NOTE_FONT_SCALE_MIN } from '../model/kinds'
import type { BoardState } from './store'
import type { Point } from './yarn'

/** What the envelope says it is. Checked on the way in, written on the way out. */
export const BOARD_FILE_FORMAT = 'dossiers-and-diagrams.board'

/**
 * The version of the *envelope*, not of any entity.
 *
 * Bumped when a reader from an older build would misunderstand the file rather
 * than merely lose a field. An unknown version is refused outright instead of
 * being read optimistically: guessing at a newer format is how a load silently
 * discards the parts it did not recognise.
 */
export const BOARD_FILE_VERSION = 1

/** What a board file is called when the board has no page to name it after. */
export const DEFAULT_BOARD_FILE_NAME = 'case-board.json'

export interface BoardFile {
  format: typeof BOARD_FILE_FORMAT
  version: number
  /** For a person reading the file, not for the reader. Ignored on the way in. */
  exportedAt: string
  board: BoardState
}

/** The result of reading a file: the board, or why it could not be read. */
export type BoardFileResult =
  | { ok: true; board: BoardState }
  | { ok: false; reason: string }

/**
 * A name for the file this board should be saved as.
 *
 * Taken from the first page rather than from a board title, because a board has
 * no title and the page it is about is the closest thing it has to one. Two
 * boards exported from the same app must not land on the same filename, and
 * "board (3).json" is what happens when they do.
 */
export function boardFileName(board: BoardState): string {
  const article = board.entities.find((entity) => entity.kind === 'article')
  const slug = (article?.title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return slug ? `${slug}.json` : DEFAULT_BOARD_FILE_NAME
}

/**
 * Read a file's text.
 *
 * `Blob.text()` is the obvious call, and it is the one this started as — but
 * jsdom does not implement it, which made the whole import path untestable and
 * would have shipped it verified only by hand. `FileReader` is older, is
 * implemented everywhere including the test environment, and the errand is a
 * single file read.
 */
export function readBoardFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('the file could not be read'))
    reader.readAsText(file)
  })
}

/** The board as the text of a file. */
export function serializeBoard(board: BoardState, now: number = Date.now()): string {
  const file: BoardFile = {
    format: BOARD_FILE_FORMAT,
    version: BOARD_FILE_VERSION,
    exportedAt: new Date(now).toISOString(),
    board,
  }
  // Two-space indent: this is a file people will open and read, and the whole
  // point of a documented format is that they can.
  return `${JSON.stringify(file, null, 2)}\n`
}

/**
 * Read a board out of a file.
 *
 * Total: never throws, whatever the text is. A file that cannot be read comes
 * back with the reason rather than an exception, because the caller's job is to
 * put that reason in front of somebody, not to handle a stack trace.
 */
export function parseBoardFile(text: string): BoardFileResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'That file is not JSON.' }
  }

  try {
    const file = asRecord(raw, 'the file')
    if (file.format !== BOARD_FILE_FORMAT) {
      return { ok: false, reason: 'That is JSON, but it is not a case board.' }
    }
    const version = number(file.version, 'version')
    if (version !== BOARD_FILE_VERSION) {
      return {
        ok: false,
        reason: `That board was written in format version ${version}, and this build reads version ${BOARD_FILE_VERSION}.`,
      }
    }

    const board = asRecord(file.board, 'board')
    const rawEntities = array(board.entities, 'board.entities')
    const entities = rawEntities.map((entity, at) => parseEntity(entity, `entities[${at}]`))

    const ids = new Set(entities.map((entity) => entity.id))
    if (ids.size !== entities.length) {
      return { ok: false, reason: 'Two things in that file share an id.' }
    }

    const strings = array(board.strings, 'board.strings').map((link, at) => {
      const parsed = parseString(link, `strings[${at}]`)
      // A string to something that is not in the file has nothing to attach to,
      // and the board draws a string with an unresolvable end to the origin.
      if (!ids.has(parsed.from) || !ids.has(parsed.to)) {
        throw new Error(`strings[${at}] is tied to something that is not in the file`)
      }
      return parsed
    })

    return { ok: true, board: { entities, strings } }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'That board could not be read.',
    }
  }
}

// ---------------------------------------------------------------------------
// Field readers
//
// Each throws with the path of the field it was reading. The message is the one
// the person sees, so it names the field rather than describing the type that
// was expected — "entities[3].board is not a point" tells them where to look.
// ---------------------------------------------------------------------------

function fail(where: string, expected: string): never {
  throw new Error(`That board could not be read: ${where} is not ${expected}.`)
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(where, 'an object')
  }
  return value as Record<string, unknown>
}

function array(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(where, 'a list')
  return value
}

function number(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(where, 'a number')
  return value
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(where, 'text')
  return value
}

/** An optional string: absent or wrong-typed becomes the fallback, never a refusal. */
function optionalText(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function point(value: unknown, where: string): Point {
  const raw = asRecord(value, where)
  return { x: number(raw.x, `${where}.x`), y: number(raw.y, `${where}.y`) }
}

function record(value: unknown, where: string): Record<string, unknown> {
  return asRecord(value, where)
}

/**
 * A string's own fields, with the board's defaults for anything absent.
 *
 * `nudge` and the title and colour are cosmetic — a file without them is a
 * board, just a plainer one — so they fall back rather than refusing the load.
 * What is required is what the board would draw wrongly without: where the
 * thing is, and what it is.
 */
function commonFields(raw: Record<string, unknown>, where: string) {
  return {
    id: text(raw.id, `${where}.id`),
    title: typeof raw.title === 'string' ? raw.title : undefined,
    bodyMd: optionalText(raw.bodyMd, ''),
    color: typeof raw.color === 'string' ? raw.color : undefined,
    visibility: oneOf<Visibility>(raw.visibility, VISIBILITIES, 'shared'),
    revealAt: optionalNumber(raw.revealAt),
    status: oneOf<ItemStatus>(raw.status, ITEM_STATUSES, 'theory'),
    dateLabel: typeof raw.dateLabel === 'string' ? raw.dateLabel : undefined,
    occurredAt: optionalNumber(raw.occurredAt),
    datePrecision: DATE_PRECISIONS.includes(raw.datePrecision as DatePrecision)
      ? (raw.datePrecision as DatePrecision)
      : undefined,
    dateInherit: raw.dateInherit !== false,
    nudge: raw.nudge === undefined ? { x: 0, y: 0 } : point(raw.nudge, `${where}.nudge`),
    zIndex: optionalNumber(raw.zIndex) ?? 0,
    version: optionalNumber(raw.version) ?? 1,
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : undefined,
    createdAt: optionalNumber(raw.createdAt) ?? 0,
    updatedAt: optionalNumber(raw.updatedAt) ?? 0,
  }
}

/** The longest image source accepted, in characters. See the note at the top. */
const MAX_IMAGE_SRC = 8 * 1024 * 1024

/** Only sources an `<img>` may be pointed at. */
const SAFE_IMAGE_SRC = /^(?:data:image\/|blob:|https?:\/\/)/i

/** A stored type size, brought back inside the range the controls allow. */
function clampFontScale(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return NOTE_FONT_SCALE_DEFAULT
  return Math.min(NOTE_FONT_SCALE_MAX, Math.max(NOTE_FONT_SCALE_MIN, value))
}

function parseAnchor(value: unknown, where: string): TextAnchor {
  const raw = record(value, where)
  return {
    quote: text(raw.quote, `${where}.quote`),
    prefix: optionalText(raw.prefix, ''),
    suffix: optionalText(raw.suffix, ''),
    startOffset: number(raw.startOffset, `${where}.startOffset`),
    endOffset: number(raw.endOffset, `${where}.endOffset`),
  }
}

function parseEntity(value: unknown, where: string): BoardEntity {
  const raw = record(value, where)
  const kind = text(raw.kind, `${where}.kind`)
  if (!ENTITY_KINDS.includes(kind as (typeof ENTITY_KINDS)[number])) {
    fail(`${where}.kind`, `one of ${ENTITY_KINDS.join(', ')}`)
  }
  const base = commonFields(raw, where)

  switch (kind) {
    case 'pin':
      // A pin is the one kind whose placement is not fixed by its name: the
      // same tack is either through a word or into the cork, and which one is
      // exactly what the anchor's presence says.
      return 'anchor' in raw
        ? {
            ...base,
            kind: 'pin',
            articleId: text(raw.articleId, `${where}.articleId`),
            anchor: parseAnchor(raw.anchor, `${where}.anchor`),
          }
        : { ...base, kind: 'pin', board: point(raw.board, `${where}.board`) }

    case 'note':
      return {
        ...base,
        kind: 'note',
        board: point(raw.board, `${where}.board`),
        width: number(raw.width, `${where}.width`),
        height: number(raw.height, `${where}.height`),
        // Absent in every file written before notes could be resized, and a
        // missing size is not a reason to refuse somebody's board: it falls
        // back to the size the note would have been drawn at anyway.
        fontScale: clampFontScale(optionalNumber(raw.fontScale)),
      }

    case 'article':
      return {
        ...base,
        kind: 'article',
        board: point(raw.board, `${where}.board`),
        rotation: optionalNumber(raw.rotation) ?? 0,
        // The article's own options already have a total parse — it is the same
        // problem and the same answer, so this calls it rather than copying it.
        options: parseArticleOptions(raw.options),
      }

    case 'image': {
      const src = text(raw.src, `${where}.src`)
      if (!SAFE_IMAGE_SRC.test(src)) {
        fail(`${where}.src`, 'an http(s), blob: or data:image/ URL')
      }
      if (src.length > MAX_IMAGE_SRC) {
        fail(`${where}.src`, `shorter than ${MAX_IMAGE_SRC} characters`)
      }
      const fit = oneOf<ImageFit>(raw.fit, IMAGE_FITS, 'cover')
      const edge = EDGE_STYLES.includes(raw.edge as EdgeStyle)
        ? (raw.edge as EdgeStyle)
        : 'clean'
      return {
        ...base,
        kind: 'image',
        board: point(raw.board, `${where}.board`),
        src,
        alt: typeof raw.alt === 'string' ? raw.alt : undefined,
        width: number(raw.width, `${where}.width`),
        height: number(raw.height, `${where}.height`),
        fit,
        rotation: optionalNumber(raw.rotation) ?? 0,
        edge,
        edgeSeed: optionalNumber(raw.edgeSeed) ?? 0,
      }
    }
  }
  // Unreachable: the kind was checked against the registry above. Written out
  // rather than cast so that adding a kind to the union is a compile error here
  // rather than a runtime surprise when somebody imports a board with one.
  throw new Error(`${where}.kind is one of the entity kinds but has no reader`)
}

function parseString(value: unknown, where: string): StringLink {
  const raw = record(value, where)
  return {
    id: text(raw.id, `${where}.id`),
    from: text(raw.from, `${where}.from`),
    to: text(raw.to, `${where}.to`),
    // Clamped rather than refused: slack outside the range is a rope that sags
    // oddly, not a board that cannot be read. `yarn.ts` clamps it again anyway.
    slack: Math.min(1, Math.max(0, optionalNumber(raw.slack) ?? 0.18)),
    color: optionalText(raw.color, '#a3302b'),
    style: oneOf<StringStyle>(raw.style, STRING_STYLES, 'solid'),
    label: typeof raw.label === 'string' && raw.label !== '' ? raw.label : undefined,
    labelAt: Math.min(1, Math.max(0, optionalNumber(raw.labelAt) ?? 0.5)),
    visibility: oneOf<Visibility>(raw.visibility, VISIBILITIES, 'shared'),
  }
}
