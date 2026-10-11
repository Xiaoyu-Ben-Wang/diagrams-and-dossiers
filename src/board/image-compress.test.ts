import { describe, expect, it, vi } from "vitest";

import {
  encodeWithinBudget,
  fitWithin,
  isRecodable,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_EDGE,
  needsShrinking,
} from "./image-compress";

function file(name: string, type = ""): { type?: string; name?: string } {
  return { name, type };
}

// The encoders never look at the pixels, and Node has no ImageData.
const pixels = {} as ImageData;

function buffer(bytes: number): ArrayBuffer {
  return new ArrayBuffer(bytes);
}

describe("fitWithin", () => {
  it("leaves a picture already inside the cap alone", () => {
    expect(fitWithin(1024, 768, 3840)).toEqual({ width: 1024, height: 768 });
  });

  it("caps the long edge and keeps the ratio", () => {
    expect(fitWithin(7680, 4320, 3840)).toEqual({ width: 3840, height: 2160 });
  });

  it("caps the long edge of a portrait, not its width", () => {
    expect(fitWithin(3000, 6000, 3840)).toEqual({ width: 1920, height: 3840 });
  });

  it("never rounds an edge away entirely", () => {
    expect(fitWithin(20000, 3, 3840)).toEqual({ width: 3840, height: 1 });
  });
});

describe("needsShrinking", () => {
  it("is false for a picture inside both budgets", () => {
    expect(needsShrinking(1920, 1080, 400 * 1024)).toBe(false);
  });

  it("is true when the bytes are over budget", () => {
    expect(needsShrinking(1920, 1080, MAX_UPLOAD_BYTES + 1)).toBe(true);
  });

  it("is true when either edge is over budget", () => {
    expect(needsShrinking(MAX_UPLOAD_EDGE + 1, 100, 1000)).toBe(true);
    expect(needsShrinking(100, MAX_UPLOAD_EDGE + 1, 1000)).toBe(true);
  });

  it("is false exactly at the budgets", () => {
    expect(
      needsShrinking(MAX_UPLOAD_EDGE, MAX_UPLOAD_EDGE, MAX_UPLOAD_BYTES),
    ).toBe(false);
  });
});

describe("isRecodable", () => {
  it("accepts the formats libwebp can re-encode", () => {
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
      "image/bmp",
    ]) {
      expect(isRecodable(file("a", type)), type).toBe(true);
    }
  });

  it("turns away the two a re-encode would damage", () => {
    // An animated GIF keeps only its first frame through a canvas, and an SVG is
    // vector until something rasterises it.
    expect(isRecodable(file("loop.gif", "image/gif"))).toBe(false);
    expect(isRecodable(file("logo.svg", "image/svg+xml"))).toBe(false);
  });

  it("falls back to the extension when the type is missing", () => {
    expect(isRecodable(file("scan.PNG"))).toBe(true);
    expect(isRecodable(file("loop.gif"))).toBe(false);
    expect(isRecodable(file("notes.txt"))).toBe(false);
  });
});

describe("encodeWithinBudget", () => {
  it("stops at the first quality that fits", async () => {
    const encode = vi.fn(async () => buffer(MAX_UPLOAD_BYTES - 1));

    await encodeWithinBudget(pixels, encode);

    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("walks the ladder down until one fits", async () => {
    const sizes = [MAX_UPLOAD_BYTES + 3, MAX_UPLOAD_BYTES + 2, 900];
    const qualities: number[] = [];
    const encode = async (_data: ImageData, quality: number) => {
      qualities.push(quality);
      return buffer(sizes[qualities.length - 1]);
    };

    const out = await encodeWithinBudget(pixels, encode);

    expect(out.byteLength).toBe(900);
    expect(qualities).toHaveLength(3);
    expect(qualities[0]).toBeGreaterThan(qualities[1]);
    expect(qualities[1]).toBeGreaterThan(qualities[2]);
  });

  it("gives up at the bottom of the ladder rather than shrink for ever", async () => {
    const qualities: number[] = [];
    const encode = async (_data: ImageData, quality: number) => {
      qualities.push(quality);
      return buffer(MAX_UPLOAD_BYTES + 100 - qualities.length);
    };

    const out = await encodeWithinBudget(pixels, encode);

    // Five rungs, every one still over budget: the last is the smallest, and is
    // worth more to the board than no picture at all.
    expect(qualities).toHaveLength(5);
    expect(out.byteLength).toBe(MAX_UPLOAD_BYTES + 95);
  });
});
