import { describe, expect, it } from "vitest";

import { DEFAULT_ARTICLE_OPTIONS } from "../model/article-options";
import {
  newAnchoredPin,
  newArticle,
  newFreePin,
  newImage,
  newNote,
  withImageFrame,
} from "../model/create";
import type { BoardEntity, StringLink } from "../model/types";
import {
  entityToRow,
  isUuid,
  rowToEntity,
  rowToString,
  stringToRow,
  type ItemRow,
} from "./mapper";

const BOARD = "11111111-1111-4111-8111-111111111111";
const ARTICLE = "22222222-2222-4222-8222-222222222222";
const NOTE = "33333333-3333-4333-8333-333333333333";
const PIN = "44444444-4444-4444-8444-444444444444";
const IMAGE = "55555555-5555-4555-8555-555555555555";
const STRING = "66666666-6666-4666-8666-666666666666";

const ANCHOR = {
  quote: "the tide keeps",
  prefix: "and ",
  suffix: " what it",
  startOffset: 12,
  endOffset: 27,
};

/** The row as Postgres would hand it back, including the columns it owns. */
function asStored(entity: BoardEntity): ItemRow {
  return {
    ...entityToRow(entity, BOARD),
    version: entity.version,
    created_by: null,
    created_at: new Date(entity.createdAt).toISOString(),
    updated_at: new Date(entity.updatedAt).toISOString(),
  };
}

const SAMPLES: [string, BoardEntity][] = [
  ["a free pin", newFreePin({ x: 12, y: -8 }, { id: PIN, title: "A pin" })],
  [
    "an anchored pin",
    newAnchoredPin(ARTICLE, ANCHOR, { id: PIN, title: "Anchored" }),
  ],
  ["a note", newNote({ x: -200, y: 40 }, { id: NOTE, bodyMd: "What we know" })],
  [
    "a page",
    newArticle(
      { x: 10, y: 20 },
      "# Page\n\nWords.",
      "A Page",
      {
        ...DEFAULT_ARTICLE_OPTIONS,
      },
      { id: NOTE },
    ),
  ],
  [
    "a picture",
    newImage(
      { x: 1, y: 2 },
      "https://example.test/a.png",
      { width: 240, height: 280 },
      {
        id: IMAGE,
        alt: "a map",
        edge: "torn",
      },
    ),
  ],
  [
    "a polaroid",
    withImageFrame(
      newImage(
        { x: 3, y: 4 },
        "https://example.test/b.png",
        { width: 10, height: 20 },
        {
          id: IMAGE,
        },
      ),
      "polaroid",
    ),
  ],
];

describe("entityToRow / rowToEntity", () => {
  it.each(SAMPLES)("round-trips %s", (_name, entity) => {
    expect(rowToEntity(asStored(entity))).toEqual(entity);
  });

  it("does not carry nudge, which is a local correction", () => {
    const nudged = {
      ...newFreePin({ x: 0, y: 0 }, { id: PIN }),
      nudge: { x: 40, y: -9 },
    };
    expect(rowToEntity(asStored(nudged)).nudge).toEqual({ x: 0, y: 0 });
  });

  it("reads an absent frame and an explicit none as the same thing", () => {
    const bare = newImage(
      { x: 0, y: 0 },
      "https://e.test/a.png",
      { width: 1, height: 1 },
      {
        id: IMAGE,
      },
    );
    expect(rowToEntity(asStored(bare)).kind).toBe("image");
    expect(
      (rowToEntity(asStored(bare)) as { frame?: string }).frame,
    ).toBeUndefined();
  });

  it("carries a kind it does not know as a failure, not a fallback", () => {
    const row = {
      ...asStored(newNote({ x: 0, y: 0 }, { id: NOTE })),
      kind: "goblin",
    };
    expect(() => rowToEntity(row)).toThrow(
      /kind is not one of pin, note, article, image/,
    );
  });

  it("falls back on values the client no longer knows", () => {
    const row = {
      ...asStored(newNote({ x: 0, y: 0 }, { id: NOTE })),
      font: "comic-sans",
      style: "dog-eared",
      visibility: "everyone",
    };
    const read = rowToEntity(row);
    expect(read.kind).toBe("note");
    expect(read).toMatchObject({
      font: "system",
      style: "plain",
      visibility: "shared",
    });
  });
});

describe("entityToRow", () => {
  it("refuses an id Postgres would reject, rather than letting it fail later", () => {
    const imported = { ...newFreePin({ x: 0, y: 0 }), id: "a-page" };
    expect(() => entityToRow(imported, BOARD)).toThrow(/id is not a uuid/);
  });

  it("names the article an anchored pin hangs from", () => {
    const row = entityToRow(
      newAnchoredPin(ARTICLE, ANCHOR, { id: PIN }),
      BOARD,
    );
    expect(row.article_id).toBe(ARTICLE);
    expect(row.anchor).toEqual(ANCHOR);
    expect(row.board_x).toBeNull();
  });

  it("leaves a free pin unanchored", () => {
    const row = entityToRow(newFreePin({ x: 5, y: 6 }, { id: PIN }), BOARD);
    expect(row.article_id).toBeNull();
    expect(row.anchor).toBeNull();
    expect([row.board_x, row.board_y]).toEqual([5, 6]);
  });
});

describe("stringToRow / rowToString", () => {
  const link: StringLink = {
    id: STRING,
    from: PIN,
    to: NOTE,
    slack: 0.18,
    style: "dashed",
    label: "owes money",
    labelAt: 0.25,
    visibility: "shared",
    version: 1,
  };

  it("round-trips a string", () => {
    expect(rowToString(stringToRow(link, BOARD))).toEqual(link);
  });

  it("clamps a label position that drifted outside the string", () => {
    expect(
      rowToString(stringToRow({ ...link, labelAt: 4 }, BOARD)).labelAt,
    ).toBe(1);
  });
});

describe("isUuid", () => {
  it("accepts what crypto.randomUUID makes and what an import might carry", () => {
    expect(isUuid(crypto.randomUUID())).toBe(true);
    expect(isUuid("a-page")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
