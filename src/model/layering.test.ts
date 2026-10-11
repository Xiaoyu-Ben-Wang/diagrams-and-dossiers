import { describe, expect, it } from "vitest";

import {
  moveInStack,
  stackingOrder,
  stackingRanks,
  type LayerMove,
} from "./layering";
import type { BoardEntity, FreePin, NoteEntity } from "./types";

const base = {
  bodyMd: "",
  visibility: "shared" as const,
  status: "theory" as const,
  dateInherit: true,
  nudge: { x: 0, y: 0 },
  zIndex: 0,
  version: 1,
  updatedAt: 0,
};

let made = 0;

function note(id: string, zIndex = 0): NoteEntity {
  return {
    ...base,
    id,
    kind: "note",
    board: { x: 0, y: 0 },
    width: 100,
    height: 100,
    fontScale: 1,
    style: "plain",
    font: "system",
    tilt: 0,
    zIndex,
    createdAt: (made += 1),
  };
}

function pin(id: string, zIndex = 0): FreePin {
  return {
    ...base,
    id,
    kind: "pin",
    board: { x: 0, y: 0 },
    zIndex,
    createdAt: (made += 1),
  };
}

const order = (entities: readonly BoardEntity[]): string[] =>
  stackingOrder(entities).map((entity) => entity.id);

/** The board after a move, as the order it would paint in. */
function after(
  entities: readonly BoardEntity[],
  id: string,
  move: LayerMove,
): string[] {
  const ranks = moveInStack(entities, new Set([id]), move);
  return order(
    entities.map((entity) =>
      ranks.has(entity.id)
        ? { ...entity, zIndex: ranks.get(entity.id)! }
        : entity,
    ),
  );
}

describe("the stack", () => {
  it("puts a pin above a note made after it", () => {
    expect(order([pin("p"), note("n")])).toEqual(["n", "p"]);
  });

  it("orders by rank, and by age where the ranks are equal", () => {
    expect(order([note("a"), note("b", 5), note("c")])).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("ranks everything below zero, frontmost closest to it", () => {
    const ranks = stackingRanks([note("a"), pin("p")]);
    expect(ranks.get("a")).toBe(-2);
    expect(ranks.get("p")).toBe(-1);
  });

  it("leaves an anchored pin out; it is drawn inside its page", () => {
    const anchored = {
      ...base,
      id: "on-a-page",
      kind: "pin" as const,
      articleId: "a1",
      anchor: {
        quote: "x",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: 1,
      },
      createdAt: (made += 1),
    };
    expect(order([anchored, note("a")])).toEqual(["a"]);
  });
});

describe("moving", () => {
  it("brings one thing to the front", () => {
    expect(after([note("a"), note("b"), note("c")], "a", "front")).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("sends one thing to the back", () => {
    expect(after([note("a"), note("b"), note("c")], "c", "back")).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("moves one thing a step either way", () => {
    expect(after([note("a"), note("b"), note("c")], "a", "forward")).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(after([note("a"), note("b"), note("c")], "c", "backward")).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("keeps a note under the pins however far forward it is brought", () => {
    expect(after([note("a"), note("b"), pin("p")], "a", "front")).toEqual([
      "b",
      "a",
      "p",
    ]);
  });

  it("keeps a note under a pin whose rank is far below it", () => {
    expect(order([note("a", 99), pin("p", -99)])).toEqual(["a", "p"]);
  });

  it("moves a group up a step without its members passing each other", () => {
    const entities = [note("a"), note("b"), note("c"), note("d")];
    const ranks = moveInStack(entities, new Set(["b", "c"]), "forward");
    expect(
      order(
        entities.map((entity) =>
          ranks.has(entity.id)
            ? { ...entity, zIndex: ranks.get(entity.id)! }
            : entity,
        ),
      ),
    ).toEqual(["a", "d", "b", "c"]);
  });

  it("answers with nothing when the move would not change the order", () => {
    const entities = [note("a"), note("b"), pin("p")];
    const nothing = (id: string, move: LayerMove) =>
      moveInStack(entities, new Set([id]), move).size;

    expect(nothing("b", "front")).toBe(0);
    expect(nothing("a", "back")).toBe(0);
    expect(nothing("a", "backward")).toBe(0);
    expect(nothing("b", "forward")).toBe(0);
    expect(nothing("p", "forward")).toBe(0);
    expect(nothing("nowhere", "front")).toBe(0);
  });
});
