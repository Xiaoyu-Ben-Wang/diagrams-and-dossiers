// What a thing's `zIndex` says is only where it sits among the others, so ordering
// is a rank rather than a number. Ranks are negative: a thing made later carries the
// default zero and so lands in front of everything that has been arranged already.

import { isPlaced, isPin, type BoardEntity } from "./types";

export const LAYER_MOVES = ["front", "forward", "backward", "back"] as const;
export type LayerMove = (typeof LAYER_MOVES)[number];

/**
 * A pin is the smallest thing on the board, the thing a string is tied to, and the
 * thing that opens a note when it is pressed, so it never goes under anything else.
 */
function band(entity: BoardEntity): number {
  return isPin(entity) ? 1 : 0;
}

function byStack(a: BoardEntity, b: BoardEntity): number {
  return (
    band(a) - band(b) ||
    a.zIndex - b.zIndex ||
    a.createdAt - b.createdAt ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Everything with a place on the board, back to front. An anchored pin is not here:
 * it is drawn inside its page and stacks there, not in the board's own order.
 */
export function stackingOrder(entities: readonly BoardEntity[]): BoardEntity[] {
  return entities.filter(isPlaced).sort(byStack);
}

/** What each of those paints at. Negative, so the layers above keep their numbering. */
export function stackingRanks(
  entities: readonly BoardEntity[],
): Map<string, number> {
  const order = stackingOrder(entities);
  return new Map(order.map((entity, at) => [entity.id, at - order.length]));
}

/**
 * The new ranks that carry out a move, for the things whose rank changes. Empty when
 * the move would not change the order — which is also how a menu item knows it would
 * do nothing.
 */
export function moveInStack(
  entities: readonly BoardEntity[],
  moving: ReadonlySet<string>,
  move: LayerMove,
): Map<string, number> {
  const order = stackingOrder(entities);
  const ids = order.map((entity) => entity.id);
  const bands = new Map(order.map((entity) => [entity.id, band(entity)]));

  // Each band is arranged on its own, so bringing a note to the front cannot carry
  // it over the pins.
  const next = [0, 1].flatMap((at) =>
    arrange(
      ids.filter((id) => bands.get(id) === at),
      moving,
      move,
    ),
  );

  if (next.every((id, at) => id === ids[at])) return new Map();

  // Compared by value, not by index: an unchanged position can still need a new rank,
  // because the ones around it moved.
  const held = new Map(order.map((entity) => [entity.id, entity.zIndex]));
  const ranks = new Map<string, number>();
  next.forEach((id, at) => {
    const rank = at - next.length;
    if (held.get(id) !== rank) ranks.set(id, rank);
  });
  return ranks;
}

/** One band's new order, or the same list back when nothing in it is moving. */
function arrange(
  ids: readonly string[],
  moving: ReadonlySet<string>,
  move: LayerMove,
): readonly string[] {
  const picked = ids
    .map((id, at) => (moving.has(id) ? at : -1))
    .filter((at) => at !== -1);
  if (picked.length === 0) return ids;

  if (move === "front" || move === "back") {
    const lifted = picked.map((at) => ids[at]);
    const rest = ids.filter((id) => !moving.has(id));
    return move === "front" ? [...rest, ...lifted] : [...lifted, ...rest];
  }

  const next = [...ids];
  // Taken from the end it is heading for, so a group steps over the same things
  // one at a time instead of a member jumping its neighbour.
  const step = move === "forward" ? 1 : -1;
  const from = move === "forward" ? [...picked].reverse() : picked;
  for (const at of from) {
    const into = at + step;
    if (into < 0 || into >= next.length) continue;
    if (moving.has(next[into])) continue;
    [next[at], next[into]] = [next[into], next[at]];
  }
  return next;
}
