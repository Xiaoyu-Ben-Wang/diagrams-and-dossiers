import type { TextAnchor } from '../anchors/types'
import type { Point } from '../board/yarn'
import type { AnchoredPin, EntityBase, FreePin, PinEntity } from './types'

// Spelled out rather than spread: a free pin spread here would carry its `board` into an
// anchored pin. A new `EntityBase` field must be added here and to FULL in pinning.test.ts.
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

export function pinToText(pin: PinEntity, articleId: string, anchor: TextAnchor): AnchoredPin {
  return {
    ...shared(pin),
    kind: 'pin',
    articleId,
    anchor,
    nudge: { x: 0, y: 0 },
  }
}

export function pinToBoard(pin: PinEntity, board: Point): FreePin {
  return {
    ...shared(pin),
    kind: 'pin',
    board,
    nudge: { x: 0, y: 0 },
  }
}

/** Compares offsets as well as quote: the same word twice is two different places to pin. */
export function sameAnchor(a: TextAnchor, b: TextAnchor): boolean {
  return a.quote === b.quote && a.startOffset === b.startOffset && a.endOffset === b.endOffset
}
