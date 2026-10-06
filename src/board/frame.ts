/**
 * What "the whole board" is, as a rectangle.
 *
 * Shared by the opening view, `fitBoard` and the image export, so that
 * "everything" cannot come to mean three different things.
 */

import { descriptorFor } from '../model/kinds'
import type { Rect } from './camera'
import type { BoardEntity, EntityContext } from '../model/types'

/** A stable empty result, so a memo depending on it does not re-run. */
export const NO_RECTS: Rect[] = []

/**
 * One box per entity that has a footprint.
 *
 * `frameBounds` before `bounds`: a pin's drawable box is its footprint rather
 * than its anchor, and a rotated sheet's is the box it sweeps.
 */
export function frameTargets(entities: readonly BoardEntity[], context: EntityContext): Rect[] {
  const targets: Rect[] = []
  for (const entity of entities) {
    const descriptor = descriptorFor(entity)
    const box = descriptor.frameBounds?.(entity, context) ?? descriptor.bounds(entity, context)
    if (box) targets.push(box)
  }
  return targets
}
