import { describe, expect, it } from "vitest";

import { descriptorFor, IMAGE_SIZE, NOTE_SIZE, POLAROID_INSETS } from "./kinds";
import {
  imageFootprint,
  MAX_IMAGE_EDGE,
  newImage,
  newNote,
  withImageFrame,
} from "./create";

describe("imageFootprint", () => {
  it("leaves a picture that already fits exactly as it is", () => {
    expect(imageFootprint(240, 120)).toEqual({ width: 240, height: 120 });
  });

  it("shrinks a photograph to the longest edge, keeping its shape", () => {
    const landscape = imageFootprint(4032, 3024);

    expect(landscape.width).toBe(MAX_IMAGE_EDGE);
    expect(landscape.height).toBeCloseTo((MAX_IMAGE_EDGE * 3024) / 4032, 0);
  });

  it("shrinks by the longest edge whichever way up the picture is", () => {
    const portrait = imageFootprint(3024, 4032);

    expect(portrait.height).toBe(MAX_IMAGE_EDGE);
    expect(portrait.width).toBeLessThan(MAX_IMAGE_EDGE);
  });

  it("never enlarges, only shrinks", () => {
    expect(imageFootprint(40, 30)).toEqual({ width: 40, height: 30 });
  });

  it("keeps a very wide picture wide", () => {
    const banner = imageFootprint(4000, 200);

    expect(banner.width).toBe(MAX_IMAGE_EDGE);
    expect(banner.height).toBeLessThan(40);
  });

  it("falls back to a usable box when the picture has no size of its own", () => {
    for (const [w, h] of [
      [0, 0],
      [Number.NaN, 10],
      [-5, 10],
    ]) {
      expect(imageFootprint(w, h)).toEqual(IMAGE_SIZE);
    }
  });
});

describe("newImage", () => {
  it("hangs straight, at the size it was measured", () => {
    const picture = newImage({ x: 10, y: 20 }, "data:image/png;base64,AAAA", {
      width: 240,
      height: 120,
    });

    expect(picture.kind).toBe("image");
    expect(picture.board).toEqual({ x: 10, y: 20 });
    expect(picture.width).toBe(240);
    expect(picture.height).toBe(120);
    expect(picture.rotation).toBe(0);
  });

  it("arrives whole, with no crop", () => {
    const picture = newImage({ x: 0, y: 0 }, "data:,", {
      width: 10,
      height: 10,
    });

    expect(picture.edge).toBe("clean");
  });

  it("takes an edge when it is given one", () => {
    const picture = newImage(
      { x: 0, y: 0 },
      "data:,",
      { width: 10, height: 10 },
      { edge: "torn" },
    );

    expect(picture.edge).toBe("torn");
  });

  it("gives each picture a border seed of its own", () => {
    const size = { width: 10, height: 10 };
    const seeds = new Set(
      Array.from(
        { length: 20 },
        () => newImage({ x: 0, y: 0 }, "data:,", size).edgeSeed,
      ),
    );

    expect(seeds.size).toBeGreaterThan(1);
    for (const seed of seeds) {
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives each picture an id of its own", () => {
    const size = { width: 10, height: 10 };
    const a = newImage({ x: 0, y: 0 }, "data:,", size);
    const b = newImage({ x: 0, y: 0 }, "data:,", size);

    expect(a.id).not.toBe(b.id);
  });

  it("does not disturb the other kinds", () => {
    const note = newNote({ x: 0, y: 0 });

    expect(note.kind).toBe("note");
    expect({ width: note.width, height: note.height }).toEqual(NOTE_SIZE);
    expect(note.width).not.toBe(IMAGE_SIZE.width);
  });

  it("writes on plain paper unless it is asked for another", () => {
    expect(newNote({ x: 0, y: 0 }).style).toBe("plain");
    expect(newNote({ x: 0, y: 0 }, { style: "grid" }).style).toBe("grid");
  });
});

describe("withImageFrame", () => {
  const picture = newImage({ x: 100, y: 50 }, "data:,", {
    width: 240,
    height: 120,
  });
  const context = {} as never;

  it("grows by the border, keeping the photo's size and the pin's place", () => {
    const framed = withImageFrame(picture, "polaroid");
    const { top, side, bottom } = POLAROID_INSETS;

    expect(framed.frame).toBe("polaroid");
    expect(framed.width).toBe(240 + 2 * side);
    expect(framed.height).toBe(120 + top + bottom);
    expect(descriptorFor(framed).anchorPoint(framed, context)).toEqual(
      descriptorFor(picture).anchorPoint(picture, context),
    );
  });

  it("takes the border back off exactly, leaving no frame key behind", () => {
    const round = withImageFrame(withImageFrame(picture, "polaroid"), "none");

    expect(round).toEqual(picture);
    expect("frame" in round).toBe(false);
  });

  it("does nothing when the frame is already the one asked for", () => {
    const framed = withImageFrame(picture, "polaroid");

    expect(withImageFrame(framed, "polaroid")).toEqual(framed);
    expect(withImageFrame(picture, "none")).toEqual(picture);
  });
});
