/**
 * Constructors for every entity kind.
 *
 * `EntityBase` carries a dozen columns the board does not yet ask the user
 * about — visibility, status, dates, version. A caller that had to spell them
 * out would be repeating the same defaults at every creation site, and would
 * silently get them wrong the day one of them changes. Creation goes through
 * here instead, so there is exactly one answer to "what is a new note, before
 * anyone has said anything about it?".
 *
 * Ids are generated on the client, as `docs/architecture.md` requires: writes
 * are idempotent upserts keyed on the id, so a retry after a dropped connection
 * cannot duplicate a pin.
 */

import type { TextAnchor } from '../anchors/types'
import type { EdgeStyle } from '../board/edges'
import type { Point } from '../board/yarn'
import { DEFAULT_ARTICLE_OPTIONS, type ArticleOptions } from './article-options'
import { IMAGE_SIZE, NOTE_FONT_SCALE_DEFAULT, NOTE_SIZE } from './kinds'
import type {
  AnchoredPin,
  ArticleEntity,
  FreePin,
  ImageEntity,
  ImageFit,
  ItemStatus,
  NoteEntity,
  Visibility,
} from './types'

/** The part of an entity a caller may reasonably want to set at creation. */
export interface EntitySeed {
  /**
   * An id to adopt rather than mint.
   *
   * Left unset by everything that creates a thing, because an id minted on the
   * client is what makes a write idempotent. It is set by the one caller that
   * is not creating anything: a board seeded from rows that already have ids,
   * where the id is the thing other rows point at and re-minting it would
   * orphan every pin anchored into that article.
   */
  id?: string
  title?: string
  bodyMd?: string
  color?: string
  visibility?: Visibility
  status?: ItemStatus
  dateLabel?: string
  occurredAt?: number
  nudge?: Point
  zIndex?: number
  createdBy?: string
}

function base(seed: EntitySeed): {
  id: string
  bodyMd: string
  visibility: Visibility
  status: ItemStatus
  dateInherit: boolean
  nudge: Point
  zIndex: number
  version: number
  createdAt: number
  updatedAt: number
} & EntitySeed {
  const now = Date.now()
  return {
    ...seed,
    id: seed.id ?? crypto.randomUUID(),
    bodyMd: seed.bodyMd ?? '',
    visibility: seed.visibility ?? 'shared',
    status: seed.status ?? 'theory',
    // A group's date flows down to its members unless one sets its own.
    dateInherit: true,
    nudge: seed.nudge ?? { x: 0, y: 0 },
    zIndex: seed.zIndex ?? 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
}

/** A tack holding a note to a passage of an article. */
export function newAnchoredPin(
  articleId: string,
  anchor: TextAnchor,
  seed: EntitySeed = {},
): AnchoredPin {
  return { ...base(seed), kind: 'pin', articleId, anchor }
}

/** A tack pushed straight into the cork. */
export function newFreePin(board: Point, seed: EntitySeed = {}): FreePin {
  return { ...base(seed), kind: 'pin', board }
}

/** A loose note on the board. */
export function newNote(
  board: Point,
  seed: EntitySeed & { fontScale?: number } = {},
): NoteEntity {
  const { fontScale, ...rest } = seed
  return {
    ...base(rest),
    kind: 'note',
    board,
    ...NOTE_SIZE,
    fontScale: fontScale ?? NOTE_FONT_SCALE_DEFAULT,
  }
}

/**
 * A sheet of markdown lying on the board.
 *
 * It opens hanging straight, the way a picture does. A new page has not been
 * pinned up in a hurry yet, so there is nothing for an angle to say.
 */
export function newArticle(
  board: Point,
  bodyMd: string,
  title: string,
  options: ArticleOptions = DEFAULT_ARTICLE_OPTIONS,
  seed: EntitySeed = {},
): ArticleEntity {
  return { ...base({ ...seed, bodyMd, title }), kind: 'article', board, rotation: 0, options }
}

/**
 * A seed for a picture's generated border.
 *
 * Any 31-bit value; `edges.ts` hashes it, so the only thing asked of this is
 * that successive calls differ. Kept out of the generator because the
 * generator's determinism is what its cache and its tests rest on.
 */
export function freshEdgeSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff)
}

/** The longest edge a dropped image is allowed to occupy, in board px. */
export const MAX_IMAGE_EDGE = 420

/**
 * Scale a real image's pixel dimensions down to something that fits a board.
 *
 * A photograph straight off a phone is several thousand pixels across; dropped
 * at its own size it would be larger than the article. Neither enlarging nor
 * distorting is right, so this only ever shrinks, and preserves the ratio.
 */
export function imageFootprint(
  pixelWidth: number,
  pixelHeight: number,
): { width: number; height: number } {
  const longest = Math.max(pixelWidth, pixelHeight)
  // Both dimensions, not just the longest: a decoder that reports a negative
  // width alongside a sane height passes a check on the maximum alone, and the
  // result is a picture with a negative box — which every rect downstream then
  // faithfully propagates.
  const usable =
    Number.isFinite(pixelWidth) &&
    Number.isFinite(pixelHeight) &&
    pixelWidth > 0 &&
    pixelHeight > 0
  if (!usable) {
    return { width: IMAGE_SIZE.width, height: IMAGE_SIZE.height }
  }
  const scale = longest > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longest : 1
  return {
    width: Math.round(pixelWidth * scale),
    height: Math.round(pixelHeight * scale),
  }
}

/**
 * A picture pinned to the board, hanging straight until it is swung.
 *
 * The footprint has to be supplied: it comes from decoding the file, which
 * only the caller can do. Passing a default here would put a differently
 * shaped picture inside every box on the board.
 */
export function newImage(
  board: Point,
  src: string,
  size: { width: number; height: number },
  seed: EntitySeed & { alt?: string; fit?: ImageFit; edge?: EdgeStyle } = {},
): ImageEntity {
  const { alt, fit, edge, ...rest } = seed
  return {
    ...base(rest),
    kind: 'image',
    board,
    src,
    width: size.width,
    height: size.height,
    alt,
    fit: fit ?? 'cover',
    rotation: 0,
    // A picture arrives whole. The crop is something you do to it, so an
    // untouched photograph is not already pretending to be a burnt one.
    edge: edge ?? 'clean',
    edgeSeed: freshEdgeSeed(),
  }
}
