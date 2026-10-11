import { describe, expect, it } from "vitest";

import { newImage, withImageFrame } from "./create";
import {
  clampSpot,
  imageMarkPoint,
  imagePhotoBox,
  imageSpot,
  imageSpotHit,
  POLAROID_INSETS,
} from "./image-mark";

const picture = (over: Record<string, unknown> = {}) => ({
  ...newImage({ x: 40, y: 70 }, "idb:cat", { width: 260, height: 200 }),
  ...over,
});

describe("imageMarkPoint", () => {
  it("names the same spot the point came from, at any angle", () => {
    const spot = { u: 0.25, v: 0.8 };

    for (const rotation of [0, 30, -30, 45]) {
      const image = picture({ rotation });
      const point = imageMarkPoint(image, spot)!;
      const back = imageSpot(image, point)!;

      expect(back.u).toBeCloseTo(spot.u);
      expect(back.v).toBeCloseTo(spot.v);
    }
  });

  it("moves with the picture", () => {
    const spot = { u: 0.25, v: 0.8 };
    const before = imageMarkPoint(picture(), spot)!;
    const after = imageMarkPoint(picture({ board: { x: 140, y: 170 } }), spot)!;

    expect(after.x - before.x).toBe(100);
    expect(after.y - before.y).toBe(100);
  });

  it("scales with the picture, so a resize keeps it on the same part of the photo", () => {
    const spot = { u: 0.25, v: 0.8 };
    const before = imageMarkPoint(picture(), spot)!;
    const after = imageMarkPoint(picture({ width: 520, height: 400 }), spot)!;

    expect(after.x - 40).toBeCloseTo((before.x - 40) * 2);
    expect(after.y - 70).toBeCloseTo((before.y - 70) * 2);
  });

  it("turns with the picture", () => {
    const image = picture();
    // The photo's top-right corner: one half-width to the right of the pivot.
    const level = imageMarkPoint(image, { u: 1, v: 0 })!;
    const swung = imageMarkPoint(picture({ rotation: 90 }), { u: 1, v: 0 })!;
    const pivot = { x: 40 + 260 / 2, y: 70 };

    expect(level.x).toBeCloseTo(pivot.x + 130);
    // A quarter turn puts it the same distance *below* the pivot, where its old y was the pivot's.
    expect(swung.x).toBeCloseTo(pivot.x);
    expect(swung.y).toBeCloseTo(pivot.y + 130);
  });

  it("rides the photo when a polaroid border is added", () => {
    const spot = { u: 0.25, v: 0.8 };
    const plain = picture();
    const framed = withImageFrame(plain, "polaroid");

    const before = imageMarkPoint(plain, spot)!;
    const after = imageMarkPoint(framed, spot)!;

    // The border is inside `width`/`height`, so the photo moves down by its top edge and keeps
    // its x. A spot kept as a fraction of the *card* would slide by the side border instead.
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y - before.y).toBeCloseTo(POLAROID_INSETS.top);
    expect(imageSpot(framed, after)!.v).toBeCloseTo(spot.v);
  });

  it("refuses a degenerate photo rather than returning a NaN point", () => {
    const flat = picture({ width: 0, height: 0 });

    expect(imageMarkPoint(flat, { u: 0.5, v: 0.5 })).toBeNull();
    expect(imageSpot(flat, { x: 0, y: 0 })).toBeNull();
    expect(imageSpotHit(flat, { x: 0, y: 0 })).toBeNull();
  });
});

describe("imageSpotHit", () => {
  it("misses a point off the card, and takes one on its very edge", () => {
    const image = picture();

    expect(imageSpotHit(image, { x: 39, y: 100 })).toBeNull();
    expect(imageSpotHit(image, { x: 100, y: 69 })).toBeNull();
    expect(imageSpotHit(image, { x: 100, y: 70 + 201 })).toBeNull();

    // The edge counts as on the card, the way `overAnyArticle` treats a page's box.
    expect(imageSpotHit(image, { x: 40 + 260, y: 100 })).toEqual({
      u: 1,
      v: 0.15,
    });
  });

  it("clamps a point on the frame's own border onto the nearest edge of the photo", () => {
    const framed = withImageFrame(picture(), "polaroid");
    const hit = imageSpotHit(framed, {
      x: framed.board.x + 2,
      y: framed.board.y + 100,
    })!;

    expect(hit.u).toBe(0);
    expect(hit.v).toBeCloseTo((100 - POLAROID_INSETS.top) / 200);
  });

  it("reports a spot past the edge unclamped, so a drag can follow the pointer off it", () => {
    const image = picture();

    expect(imageSpot(image, { x: 40 + 260 + 130, y: 70 + 100 })!.u).toBeCloseTo(
      1.5,
    );
  });
});

describe("clampSpot", () => {
  it("keeps a spot inside the photo, and never lets one become NaN", () => {
    expect(clampSpot({ u: 2, v: -3 })).toEqual({ u: 1, v: 0 });
    expect(clampSpot({ u: Number.NaN, v: 0.5 })).toEqual({ u: 0, v: 0.5 });
  });
});

describe("imagePhotoBox", () => {
  it("is the whole card when there is no frame", () => {
    expect(imagePhotoBox(picture())).toEqual({
      x: 0,
      y: 0,
      width: 260,
      height: 200,
    });
  });
});
