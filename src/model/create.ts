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
import type { Point } from '../board/yarn'
import { DEFAULT_ARTICLE_OPTIONS, type ArticleOptions } from './article-options'
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
    id: crypto.randomUUID(),
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
export function newNote(board: Point, seed: EntitySeed = {}): NoteEntity {
  return { ...base(seed), kind: 'note', board }
}

/** A sheet of markdown lying on the board. */
export function newArticle(
  board: Point,
  bodyMd: string,
  title: string,
  options: ArticleOptions = DEFAULT_ARTICLE_OPTIONS,
  seed: EntitySeed = {},
): ArticleEntity {
  return { ...base({ ...seed, bodyMd, title }), kind: 'article', board, options }
}

/** A picture pinned to the board, hanging straight until it is swung. */
export function newImage(
  board: Point,
  src: string,
  seed: EntitySeed & { alt?: string; fit?: ImageFit } = {},
): ImageEntity {
  const { alt, fit, ...rest } = seed
  return {
    ...base(rest),
    kind: 'image',
    board,
    src,
    alt,
    fit: fit ?? 'cover',
    rotation: 0,
  }
}
