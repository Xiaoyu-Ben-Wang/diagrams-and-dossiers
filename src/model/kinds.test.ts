import { describe, expect, it } from "vitest";

import { rotateAbout } from "../board/pivot";
import {
  descriptorFor,
  descriptorOf,
  IMAGE_PIN_INSET,
  IMAGE_SIZE,
  NOTE_FONT_SCALE_DEFAULT,
  NOTE_FONT_SCALE_MAX,
  NOTE_FONT_SCALE_MIN,
  NOTE_SIZE,
  NOTE_TILT_MAX,
  TACK_SIZE,
  stepFontScale,
  tackPoint,
  TACK_RADIUS,
  TACK_OFFSET_X,
  TACK_OFFSET_Y,
  seededTear,
  seededTilt,
} from "./kinds";
import {
  ENTITY_KINDS,
  isAnchoredPin,
  isPlaced,
  type AnchoredPin,
  type ArticleEntity,
  type BoardEntity,
  type EntityContext,
  type FreePin,
  type ImageEntity,
  type NoteEntity,
} from "./types";

const NOW = 1_700_000_000_000;

const base = {
  id: "e1",
  bodyMd: "",
  visibility: "shared" as const,
  status: "theory" as const,
  dateInherit: true,
  nudge: { x: 0, y: 0 },
  zIndex: 0,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

const freePin = (over: Partial<FreePin> = {}): FreePin => ({
  ...base,
  kind: "pin",
  board: { x: 100, y: 200 },
  ...over,
});

const anchoredPin = (over: Partial<AnchoredPin> = {}): AnchoredPin => ({
  ...base,
  id: "a1",
  kind: "pin",
  articleId: "art1",
  anchor: {
    quote: "the bell",
    prefix: "",
    suffix: "",
    startOffset: 0,
    endOffset: 8,
  },
  ...over,
});

const note = (over: Partial<NoteEntity> = {}): NoteEntity => ({
  ...base,
  kind: "note",
  board: { x: 10, y: 20 },
  width: NOTE_SIZE.width,
  height: NOTE_SIZE.height,
  fontScale: 1,
  style: "plain",
  font: "system",
  tilt: 0,
  ...over,
});

const article = (over: Partial<ArticleEntity> = {}): ArticleEntity => ({
  ...base,
  kind: "article",
  board: { x: 0, y: 0 },
  rotation: 0,
  options: {
    width: 720,
    typeScale: "normal",
    paper: "parchment",
    titleBar: true,
    editable: true,
    acceptsPins: true,
    collapsible: false,
    collapsed: false,
  },
  ...over,
});

const image = (over: Partial<ImageEntity> = {}): ImageEntity => ({
  ...base,
  kind: "image",
  board: { x: 50, y: 60 },
  src: "data:image/png;base64,AAAA",
  width: IMAGE_SIZE.width,
  height: IMAGE_SIZE.height,
  fit: "cover",
  rotation: 0,
  edge: "clean" as const,
  edgeSeed: 1,
  ...over,
});

const emptyContext: EntityContext = {
  articleToBoard: () => null,
  anchorRect: () => null,
  articleSize: () => null,
};

describe("the registry covers every kind", () => {
  it("answers for each kind in the union", () => {
    for (const kind of ENTITY_KINDS) {
      expect(descriptorOf(kind).kind).toBe(kind);
    }
  });

  it("routes an instance to its own descriptor", () => {
    expect(descriptorFor(note()).kind).toBe("note");
    expect(descriptorFor(image()).kind).toBe("image");
    expect(descriptorFor(article()).kind).toBe("article");
    expect(descriptorFor(freePin()).kind).toBe("pin");
  });
});

describe("placement is carried by the shape", () => {
  it("tells the two pins apart by what they hold, not by a flag", () => {
    expect(isAnchoredPin(anchoredPin())).toBe(true);
    expect(isAnchoredPin(freePin())).toBe(false);
    expect(isAnchoredPin(note())).toBe(false);
  });

  it("counts every kind that knows its own position as placed", () => {
    expect(isPlaced(freePin())).toBe(true);
    expect(isPlaced(note())).toBe(true);
    expect(isPlaced(article())).toBe(true);
    expect(isPlaced(image())).toBe(true);
    expect(isPlaced(anchoredPin())).toBe(false);
  });
});

describe("capabilities", () => {
  it("lets a tack in the cork be rubber-banded but not one in a word", () => {
    const cork = descriptorFor(freePin()).capabilities(freePin());
    const word = descriptorFor(anchoredPin()).capabilities(anchoredPin());
    expect(cork.marqueeSelectable).toBe(true);
    expect(word.marqueeSelectable).toBe(false);
    expect(cork.movable).toBe(true);
    expect(word.movable).toBe(true);
  });

  it("marks the two sheets as rotatable and the flat things as not", () => {
    expect(descriptorFor(image()).capabilities(image()).rotatable).toBe(true);
    expect(descriptorFor(article()).capabilities(article()).rotatable).toBe(
      true,
    );
    for (const entity of [freePin(), anchoredPin(), note()] as BoardEntity[]) {
      expect(descriptorFor(entity).capabilities(entity).rotatable).toBe(false);
    }
  });

  it("lets the rubber band take a page, so a group can be dragged whole", () => {
    const page = article();
    expect(descriptorFor(page).capabilities(page).marqueeSelectable).toBe(true);
  });

  it("lets an article forbid editing without forbidding moving", () => {
    const locked = article({
      options: { ...article().options, editable: false },
    });
    const caps = descriptorFor(locked).capabilities(locked);
    expect(caps.editable).toBe(false);
    expect(caps.movable).toBe(true);
  });
});

describe("anchor points", () => {
  it("centres a free pin on its tack", () => {
    const at = descriptorFor(freePin()).anchorPoint(freePin(), emptyContext);
    expect(at).toEqual({ x: 100, y: 200 });
  });

  it("resolves an anchored pin through the article, not from a position it lacks", () => {
    const placed: { local: unknown }[] = [];
    const context: EntityContext = {
      ...emptyContext,
      articleToBoard: (_id, local) => {
        placed.push({ local });
        return { x: 1000 + local.x, y: 500 + local.y };
      },
      anchorRect: () => ({ x: 10, y: 20, width: 40, height: 12 }),
    };

    const at = descriptorFor(anchoredPin()).anchorPoint(anchoredPin(), context);
    const tack = tackPoint({ x: 10, y: 20, width: 40, height: 12 });

    expect(at).toEqual({ x: 1000 + tack.x, y: 500 + tack.y });
    expect(placed[0].local).toEqual({ x: tack.x, y: tack.y });
  });

  it("gives an anchored pin no anchor at all until its quote resolves", () => {
    expect(
      descriptorFor(anchoredPin()).anchorPoint(anchoredPin(), emptyContext),
    ).toBeNull();
  });

  it("carries a nudge with both kinds of pin", () => {
    const nudged = freePin({ nudge: { x: 5, y: -3 } });
    expect(descriptorFor(nudged).anchorPoint(nudged, emptyContext)).toEqual({
      x: 105,
      y: 197,
    });
  });

  it("pins an image just inside its top edge, so the whole tack is on it", () => {
    const at = descriptorFor(image()).anchorPoint(image(), emptyContext);

    expect(at).toEqual({
      x: 50 + IMAGE_SIZE.width / 2,
      y: 60 + IMAGE_PIN_INSET,
    });
    expect(IMAGE_PIN_INSET).toBeGreaterThanOrEqual(TACK_SIZE / 2);
  });

  it("turns the inset pin with the sheet, since it is inside the paper", () => {
    const upright = descriptorFor(image()).anchorPoint(image(), emptyContext);
    const swung = image({ rotation: 90 });
    const tilted = descriptorFor(swung).anchorPoint(swung, emptyContext);

    expect(tilted).not.toEqual(upright);
    expect(tilted).not.toBeNull();
    expect(Math.round(tilted!.x - (50 + IMAGE_SIZE.width / 2))).toBe(
      -IMAGE_PIN_INSET,
    );
    expect(Math.round(tilted!.y)).toBe(60);
  });

  it("meets a note along the middle of its top edge, where it is held", () => {
    const at = descriptorFor(note()).anchorPoint(note(), emptyContext);
    expect(at).toEqual({ x: 10 + NOTE_SIZE.width / 2, y: 20 });
  });

  it("keeps a string on the top edge when the note is resized", () => {
    const at = (width: number, height: number) => {
      const entity = note({ width, height });
      return descriptorFor(entity).anchorPoint(entity, emptyContext);
    };

    expect(at(NOTE_SIZE.width, NOTE_SIZE.height)).toEqual({
      x: 10 + NOTE_SIZE.width / 2,
      y: 20,
    });
    expect(at(300, 240)).toEqual({ x: 10 + 150, y: 20 });
  });

  it("ties an article at the tab on its top edge", () => {
    expect(
      descriptorFor(article()).anchorPoint(article(), emptyContext),
    ).toEqual({ x: 360, y: 0 });
  });

  it("puts each page’s tab at its own width", () => {
    const narrow = article({
      id: "narrow",
      options: { ...article().options, width: 480 },
    });
    const wide = article({
      id: "wide",
      options: { ...article().options, width: 960 },
    });

    expect(descriptorFor(narrow).anchorPoint(narrow, emptyContext)).toEqual({
      x: 240,
      y: 0,
    });
    expect(descriptorFor(wide).anchorPoint(wide, emptyContext)).toEqual({
      x: 480,
      y: 0,
    });
  });

  it("measures the page itself once it is asked for a box", () => {
    const context: EntityContext = {
      ...emptyContext,
      articleSize: () => ({ width: 300, height: 400 }),
    };
    expect(descriptorFor(article()).bounds(article(), context)).toMatchObject({
      width: 300,
      height: 400,
    });
    expect(descriptorFor(article()).bounds(article(), emptyContext)).toBeNull();
  });
});

describe("bounds", () => {
  it("gives a tack no area, so the marquee cannot intersect it by accident", () => {
    const box = descriptorFor(freePin()).bounds(freePin(), emptyContext);
    expect(box).toMatchObject({ width: 0, height: 0 });
  });

  it("gives a note its footprint from the corner it is drawn at", () => {
    expect(descriptorFor(note()).bounds(note(), emptyContext)).toEqual({
      x: 10,
      y: 20,
      width: NOTE_SIZE.width,
      height: NOTE_SIZE.height,
    });
  });

  it("grows the box of a tilting image", () => {
    const upright = descriptorFor(image()).bounds(image(), emptyContext)!;
    const tilted = descriptorFor(image({ rotation: 45 })).bounds(
      image({ rotation: 45 }),
      emptyContext,
    )!;

    expect(tilted.width).toBeGreaterThan(upright.width);
    expect(tilted.height).toBeGreaterThan(upright.height);
  });

  it("swings an image about its pin, not about its middle", () => {
    const pivot = { x: 50 + IMAGE_SIZE.width / 2, y: 60 };
    const tilted = descriptorFor(image({ rotation: 45 })).bounds(
      image({ rotation: 45 }),
      emptyContext,
    )!;

    expect(rotateAbout(pivot, pivot, 45)).toEqual(pivot);
    expect(tilted.x).toBeLessThanOrEqual(pivot.x);
    expect(tilted.x + tilted.width).toBeGreaterThanOrEqual(pivot.x);
    expect(tilted.y).toBeLessThanOrEqual(pivot.y);
    expect(tilted.y + tilted.height).toBeGreaterThanOrEqual(pivot.y);
  });

  it("never emits a non-finite box", () => {
    for (const entity of [
      freePin(),
      note(),
      article(),
      image(),
    ] as BoardEntity[]) {
      const box = descriptorFor(entity).bounds(entity, emptyContext);
      if (!box) continue;
      for (const value of [box.x, box.y, box.width, box.height]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe("move", () => {
  it("moves a free pin by its position", () => {
    const moved = descriptorFor(freePin()).move(freePin(), { x: 5, y: 7 });
    expect(moved).toMatchObject({ board: { x: 105, y: 207 } });
  });

  it("stores the shift of an anchored pin as an offset, leaving the anchor alone", () => {
    const pin = anchoredPin();
    const moved = descriptorFor(pin).move(pin, { x: 5, y: 7 });
    expect(moved).toMatchObject({ nudge: { x: 5, y: 7 } });
    expect((moved as AnchoredPin).anchor).toBe(pin.anchor);
  });

  it("accumulates a nudge across repeated moves", () => {
    const once = descriptorFor(anchoredPin()).move(anchoredPin(), {
      x: 5,
      y: 5,
    });
    const twice = descriptorFor(once).move(once, { x: 2, y: -1 });
    expect(twice.nudge).toEqual({ x: 7, y: 4 });
  });

  it("moves every placed kind by the same delta", () => {
    const cases = [
      [note(), { x: 10, y: 20 }],
      [article(), { x: 0, y: 0 }],
      [image(), { x: 50, y: 60 }],
    ] as const;
    for (const [entity, start] of cases) {
      const moved = descriptorFor(entity).move(entity, { x: 3, y: 4 });
      expect((moved as { board: { x: number; y: number } }).board).toEqual({
        x: start.x + 3,
        y: start.y + 4,
      });
    }
  });

  it("leaves rotation alone when an image is dragged", () => {
    const tilted = image({ rotation: 30 });
    expect(descriptorFor(tilted).move(tilted, { x: 1, y: 1 })).toMatchObject({
      rotation: 30,
    });
  });

  it("does not mutate the entity it was given", () => {
    const pin = freePin();
    descriptorFor(pin).move(pin, { x: 99, y: 99 });
    expect(pin.board).toEqual({ x: 100, y: 200 });
  });
});

describe("the tack offset is stated once", () => {
  it("puts the tack centre half a tack in from the drawn corner", () => {
    // The renderer draws a tack at rect + TACK_OFFSET; if these drift apart, strings miss their tacks.
    const rect = { x: 0, y: 0, width: 20, height: 10 };
    expect(tackPoint(rect)).toEqual({
      x: 20 + TACK_OFFSET_X + TACK_RADIUS,
      y: 0 + TACK_OFFSET_Y + TACK_RADIUS,
    });
  });
});

describe("stepping a note’s type size", () => {
  it("goes up and down in even steps", () => {
    expect(stepFontScale(1, 1)).toBe(1.125);
    expect(stepFontScale(1, -1)).toBe(0.875);
  });

  it("stops at both ends rather than running away", () => {
    expect(stepFontScale(NOTE_FONT_SCALE_MAX, 1)).toBe(NOTE_FONT_SCALE_MAX);
    expect(stepFontScale(NOTE_FONT_SCALE_MIN, -1)).toBe(NOTE_FONT_SCALE_MIN);
  });

  it("comes back to where it started, with no drift", () => {
    let scale = NOTE_FONT_SCALE_DEFAULT;
    for (let i = 0; i < 6; i++) scale = stepFontScale(scale, 1);
    for (let i = 0; i < 6; i++) scale = stepFontScale(scale, -1);
    expect(scale).toBe(NOTE_FONT_SCALE_DEFAULT);
  });

  it("reaches both ends exactly from the default", () => {
    let up = NOTE_FONT_SCALE_DEFAULT;
    while (up < NOTE_FONT_SCALE_MAX) up = stepFontScale(up, 1);
    expect(up).toBe(NOTE_FONT_SCALE_MAX);

    let down = NOTE_FONT_SCALE_DEFAULT;
    while (down > NOTE_FONT_SCALE_MIN) down = stepFontScale(down, -1);
    expect(down).toBe(NOTE_FONT_SCALE_MIN);
  });
});

describe("the lean a note is given", () => {
  it("is the same every time, for the same id", () => {
    expect(seededTilt("note-abcdef")).toBe(seededTilt("note-abcdef"));
  });

  it("does not give neighbouring ids the same angle", () => {
    const angles = ["n1", "n2", "n3", "n4", "n5"].map(seededTilt);
    expect(new Set(angles).size).toBeGreaterThan(1);
  });

  it("stays inside the range a note may lean", () => {
    for (let i = 0; i < 500; i++) {
      expect(Math.abs(seededTilt(`note-${i}`))).toBeLessThanOrEqual(
        NOTE_TILT_MAX,
      );
    }
  });
});

describe("the tear a note's top edge gets", () => {
  it("is the same every time, for the same id", () => {
    expect(seededTear("note-abcdef")).toBe(seededTear("note-abcdef"));
  });

  it("differs between notes, so no two are torn alike", () => {
    const tears = ["n1", "n2", "n3", "n4", "n5"].map(seededTear);
    expect(new Set(tears).size).toBeGreaterThan(1);
  });

  it("is a closed polygon that keeps the body of the note", () => {
    const tear = seededTear("note-1");
    expect(tear.startsWith("polygon(")).toBe(true);
    expect(tear.endsWith("100% 100%, 0% 100%)")).toBe(true);
    expect(tear).not.toContain("NaN");
  });

  it("never bites deeper than the header row, where the controls sit", () => {
    for (let i = 0; i < 200; i += 1) {
      const depths = [...seededTear(`note-${i}`).matchAll(/(\d+)px/g)].map(
        (m) => Number(m[1]),
      );
      expect(Math.max(...depths)).toBeLessThanOrEqual(8);
    }
  });
});
