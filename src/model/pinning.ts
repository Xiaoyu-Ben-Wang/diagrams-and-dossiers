/**
 * Moving a pin between the two places a pin can live.
 *
 * A pin is one kind with two homes — through a word in an article, or straight
 * into the cork — and the gesture that changes which is a drag. Dragging a tack
 * is the only way to say "not there, *there*", so it has to be able to change
 * the answer rather than merely shift it.
 *
 * It could not, before. `move` records a delta as `nudge`, which is right for
 * the small correction it was built for — shuffling two tacks off the same word
 * so they stop overlapping — but it left the pin welded to the words it was
 * first given. Dropping a pin on "ledger" moved the tack and left it still
 * claiming to be on "Saltmarsh", and a pin carried in from the cork sat on the
 * text without ever being stuck into it.
 *
 * These are the two conversions that fix that. Both keep the entity's identity
 * — id, body, dates, status — because the pin is the same pin; only the thing
 * holding it changes. Both clear the nudge, because a nudge is measured against
 * a home the pin no longer has, and carrying it over would drag the tack off
 * the words it was just placed on.
 */

import type { TextAnchor } from '../anchors/types'
import type { Point } from '../board/yarn'
import type { AnchoredPin, EntityBase, FreePin, PinEntity } from './types'

/**
 * The half of a pin that is not about where it is.
 *
 * Spelled out rather than spread, because the placement fields are exactly what
 * must not survive the move: a free pin spread into `pinToText` would carry its
 * `board` along, and an entity holding both a board and an anchor is the state
 * the schema's `CHECK (anchor XOR board)` exists to forbid.
 *
 * The cost of writing the list out is that a field added to `EntityBase` is
 * dropped here until someone remembers. `pinning.test.ts` fails if that
 * happens — it moves a pin with every base field set and checks they all
 * arrive.
 */
function shared(pin: PinEntity): Omit<EntityBase, 'nudge'> {
  return {
    id: pin.id,
    title: pin.title,
    bodyMd: pin.bodyMd,
    color: pin.color,
    visibility: pin.visibility,
    revealAt: pin.revealAt,
    status: pin.status,
    dateLabel: pin.dateLabel,
    occurredAt: pin.occurredAt,
    datePrecision: pin.datePrecision,
    dateInherit: pin.dateInherit,
    zIndex: pin.zIndex,
    version: pin.version,
    createdBy: pin.createdBy,
    createdAt: pin.createdAt,
    updatedAt: Date.now(),
  }
}

/**
 * Stick a pin through a passage of an article.
 *
 * Takes any pin, so this is also the "a cork pin was dropped on the text" case
 * — the pin keeps its id and its note, and gains an article and a quote.
 */
export function pinToText(pin: PinEntity, articleId: string, anchor: TextAnchor): AnchoredPin {
  return {
    ...shared(pin),
    kind: 'pin',
    articleId,
    anchor,
    nudge: { x: 0, y: 0 },
  }
}

/**
 * Push a pin into the cork.
 *
 * The inverse, and the one that runs when a pin is dragged off the paper. The
 * quote is dropped with the anchor: a pin in the cork is not holding any words,
 * and keeping a stale quote would have it describe a passage it is no longer
 * anywhere near.
 */
export function pinToBoard(pin: PinEntity, board: Point): FreePin {
  return {
    ...shared(pin),
    kind: 'pin',
    board,
    nudge: { x: 0, y: 0 },
  }
}

/**
 * Whether two anchors hold the same words in the same place.
 *
 * Used to tell "I nudged this tack aside" from "I moved this pin to a different
 * passage" — the first should keep the offset, the second must not. Compares
 * the offsets as well as the quote, because the same word appearing twice is
 * genuinely two different places to pin.
 */
export function sameAnchor(a: TextAnchor, b: TextAnchor): boolean {
  return a.quote === b.quote && a.startOffset === b.startOffset && a.endOffset === b.endOffset
}
