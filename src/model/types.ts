/**
 * What a thing on the board *is*.
 *
 * This is the client's half of the schema in `supabase/migrations/0001_init.sql`.
 * Before it, the board had three unrelated shapes — `PlacedPin`, `PinView` and
 * `PostIt` — for what the database calls one row: an item whose `kind`, and
 * therefore whose location, is a discriminator. A pin and a post-it are the same
 * note in different places; an article is the same thing again with a body that
 * happens to be markdown.
 *
 * The important consequence is that **placement is carried by the kind**. The
 * schema enforces "anchored to text XOR sitting at a board point" with a CHECK
 * constraint, because a row with both is a bug that is painful to debug later.
 * Here the union makes that state unrepresentable, which is a stronger guarantee
 * than a runtime guard: `Pin` has an anchor and no `board`, and the kinds that
 * have a `board` have no anchor.
 *
 * Field names match the columns exactly. That is deliberate — when persistence
 * lands, a row maps to an entity by renaming, not by interpretation.
 */

import type { AnchorRect } from '../anchors/dom'
import type { TextAnchor } from '../anchors/types'
import type { EdgeStyle } from '../board/edges'
import type { Rect } from '../board/camera'
import type { Point } from '../board/yarn'
import type { ArticleOptions } from './article-options'

export const ENTITY_KINDS = ['pin', 'note', 'article', 'image'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

/** Who may see it. `dm` is the DM layer; see `access/permissions`. */
export const VISIBILITIES = ['shared', 'dm'] as const
export type Visibility = (typeof VISIBILITIES)[number]

/** Where a theory stands. Unrelated to anchor resolution — see `Resolution`. */
export const ITEM_STATUSES = ['theory', 'confirmed', 'disproven'] as const
export type ItemStatus = (typeof ITEM_STATUSES)[number]

export const DATE_PRECISIONS = ['year', 'month', 'day', 'exact'] as const
export type DatePrecision = (typeof DATE_PRECISIONS)[number]

/** How a string is drawn. Only `solid` is produced today; the rest are schema. */
export const STRING_STYLES = ['solid', 'dashed', 'double'] as const
export type StringStyle = (typeof STRING_STYLES)[number]

export const ROLES = ['viewer', 'editor', 'dm', 'owner'] as const
export type Role = (typeof ROLES)[number]

/** Scale limits on a pinned image, in degrees either way. */
export const MAX_IMAGE_ROTATION = 45
export const IMAGE_FITS = ['cover', 'contain'] as const
export type ImageFit = (typeof IMAGE_FITS)[number]

/**
 * Everything every kind has, mirroring the shared columns on `items`.
 *
 * `nudge` is the odd one out: it is not a column, it is how a manual offset is
 * stored for an entity whose real position it does not own. An anchored pin's
 * place on the board is derived from the words it holds, so dragging it is
 * recorded as a delta against that rather than by overwriting a position it
 * never had.
 */
export interface EntityBase {
  id: string
  title?: string
  bodyMd: string
  color?: string
  visibility: Visibility
  revealAt?: number
  status: ItemStatus
  dateLabel?: string
  occurredAt?: number
  datePrecision?: DatePrecision
  dateInherit: boolean
  nudge: Point
  zIndex: number
  version: number
  createdBy?: string
  createdAt: number
  updatedAt: number
}

/**
 * A tack holding a note to a passage of an article.
 *
 * It has no board position of its own — `anchor` is where it lives, and the
 * geometry is resolved through the anchor ladder every time the article is
 * re-rendered.
 */
export interface AnchoredPin extends EntityBase {
  kind: 'pin'
  articleId: string
  anchor: TextAnchor
}

/**
 * A tack pushed straight into the cork.
 *
 * A pin is the one kind whose placement is not fixed by its name: the same
 * gesture puts a tack through a word or into the board, and both are pins to
 * everyone looking at them. That costs the guarantee the other kinds get — a
 * pin may or may not have an anchor — so callers narrow with `isAnchoredPin`
 * rather than assuming.
 */
export interface FreePin extends EntityBase {
  kind: 'pin'
  board: Point
}

export type PinEntity = AnchoredPin | FreePin

/** A loose note on the cork. */
export interface NoteEntity extends EntityBase {
  kind: 'note'
  board: Point
  /**
   * The note's footprint in board px.
   *
   * Stored rather than fixed, because a note is the one kind whose size is
   * entirely a matter of how much you wrote — the default is a square of
   * paper, and dragging its corner is how you make it fit the sentence.
   */
  width: number
  height: number
}

/** A sheet of markdown lying on the board. */
export interface ArticleEntity extends EntityBase {
  kind: 'article'
  board: Point
  options: ArticleOptions
}

/**
 * A picture pinned to the board.
 *
 * `rotation` is the angle it hangs at about its own top-centre, which is also
 * where its pin is drawn and where yarn attaches — a photograph swung on a tack
 * rather than a rectangle placed on a grid.
 */
export interface ImageEntity extends EntityBase {
  kind: 'image'
  board: Point
  src: string
  alt?: string
  /**
   * The footprint on the board, in board px — not the file's pixel size.
   *
   * Measured from the decoded image when it is dropped and scaled to fit
   * `MAX_IMAGE_EDGE`, then stored, so a 4000px photograph and a 40px icon are
   * both things you can see at once and neither has to be re-measured to be
   * hit-tested. `kinds.ts` reads it rather than a constant because the whole
   * point of an image is that its shape is whatever was brought in.
   */
  width: number
  height: number
  fit: ImageFit
  /** Degrees of swing about the top-centre pin, within ±`MAX_TILT_DEG`. */
  rotation: number
  /**
   * How the picture's border is damaged — see `board/edges.ts`.
   *
   * Per picture rather than a board-wide setting, because the point of the
   * crop is that a photograph and a clipping did not arrive here the same way.
   */
  edge: EdgeStyle
  /**
   * The seed that damage is generated from, stored rather than derived.
   *
   * `edges.ts` is deterministic on purpose — the same seed gives the same
   * polygon, in this process and the next, which is what makes its cache sound
   * and its output testable. Randomness therefore goes in *here*, not in the
   * generator: a fresh number produces a fresh crop without the geometry ever
   * being non-deterministic. Re-rolled when a picture is picked up, so no two
   * looks at the same photograph show the same tear.
   */
  edgeSeed: number
}

export type BoardEntity = PinEntity | NoteEntity | ArticleEntity | ImageEntity

/** Kinds that own their position on the board, as opposed to deriving it. */
export type PlacedEntity = FreePin | NoteEntity | ArticleEntity | ImageEntity

/** True for everything that knows where it is without consulting an article. */
export function isPlaced(entity: BoardEntity): entity is PlacedEntity {
  return entity.kind !== 'pin' || 'board' in entity
}

export function isPin(entity: BoardEntity): entity is PinEntity {
  return entity.kind === 'pin'
}

export function isAnchoredPin(entity: BoardEntity): entity is AnchoredPin {
  return entity.kind === 'pin' && 'anchor' in entity
}

/** A strand of yarn. Its endpoints are entity ids; either may be any kind. */
export interface StringLink {
  id: string
  from: string
  to: string
  /** How much rope it has, as a fraction of the gap. See `sagFor`. */
  slack: number
  color: string
  style: StringStyle
  label?: string
  visibility: Visibility
}

/** A named set of entities — a case file. Schema only; no UI yet. */
export interface Group {
  id: string
  name: string
  color: string
  visibility: Visibility
  dateLabel?: string
  occurredAt?: number
  datePrecision?: DatePrecision
  memberIds: string[]
}

/**
 * Everything a descriptor needs that is not on the entity itself.
 *
 * Anchored entities cannot answer "where are you?" alone: their anchor is a
 * quote, and turning it into pixels needs the article's projection and the
 * paper's place on the board. Passing that in keeps the descriptors pure and
 * lets the resolution stay where it belongs, in the anchors layer.
 */
export interface EntityContext {
  /**
   * A point in an article's own space, in board space.
   *
   * A mapping rather than an origin, because an article can be pinned up at an
   * angle and a sheet that has been swung is not a sheet that has been moved:
   * its corner and the tack holding it are no longer in the same relationship,
   * so a caller that adds an offset to the corner lands in the wrong place as
   * soon as the page is tilted. The rotation belongs to whoever owns the page —
   * the descriptors stay pure and simply ask where a point ends up.
   */
  articleToBoard(articleId: string, local: Point): Point | null
  /** The resolved rect of a pin's anchor, in that article's space. */
  anchorRect(entityId: string): AnchorRect | null
  /** Measured footprint of an article, which sizes itself to its body. */
  articleSize(articleId: string): { width: number; height: number } | null
}

/** Whether an entity can be drawn at all — an orphaned pin's anchor is gone. */
export type Placement =
  | { at: 'board'; point: Point }
  | { at: 'article'; articleId: string; rect: AnchorRect }
  | { at: 'nowhere' }

/** The board-space rectangle an entity occupies, for marquee and framing. */
export type { Rect }
