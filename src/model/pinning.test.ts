import { describe, expect, it, vi } from "vitest";

import type { TextAnchor } from "../anchors/types";
import { newAnchoredPin, newFreePin, newImagePin } from "./create";
import { pinToBoard, pinToImage, pinToText, sameAnchor } from "./pinning";
import { isAnchoredPin, isImagePin, type EntityBase } from "./types";

const anchor: TextAnchor = {
  quote: "Saltmarsh",
  prefix: "returned to ",
  suffix: " with the",
  startOffset: 22,
  endOffset: 31,
};

/** Every optional `EntityBase` column, so a dropped one shows up as a failure. */
const FULL: Partial<EntityBase> = {
  title: "A title",
  bodyMd: "A body",
  color: "#ff0000",
  revealAt: 1700000000000,
  dateLabel: "Session 14, 1492 DR",
  occurredAt: 1699999999999,
  datePrecision: "day",
  createdBy: "user-1",
};

describe("pinToText", () => {
  it("sticks a cork pin into a passage, keeping its identity", () => {
    const pin = {
      ...newFreePin({ x: 10, y: 20 }),
      ...FULL,
      version: 4,
      id: "pin-1",
    };

    const anchored = pinToText(pin, "art-1", anchor);

    expect(anchored.id).toBe("pin-1");
    expect(anchored.version).toBe(4);
    expect(anchored.articleId).toBe("art-1");
    expect(anchored.anchor).toEqual(anchor);
    expect(isAnchoredPin(anchored)).toBe(true);
  });

  it("carries every shared column across", () => {
    const pin = { ...newFreePin({ x: 0, y: 0 }), ...FULL };

    const anchored = pinToText(pin, "art-1", anchor);

    for (const [key, value] of Object.entries(FULL)) {
      expect(anchored[key as keyof EntityBase], key).toEqual(value);
    }
  });

  it("drops the old board position rather than keeping both placements", () => {
    // A board and an anchor together is the state the schema's location CHECK forbids.
    const pin = newFreePin({ x: 10, y: 20 });

    const anchored = pinToText(pin, "art-1", anchor);

    expect("board" in anchored).toBe(false);
  });

  it("clears the nudge, which was measured against the old home", () => {
    const pin = {
      ...newAnchoredPin("art-1", anchor),
      nudge: { x: 40, y: -12 },
    };

    const moved = pinToText(pin, "art-1", {
      ...anchor,
      quote: "ledger",
      startOffset: 300,
      endOffset: 306,
    });

    expect(moved.nudge).toEqual({ x: 0, y: 0 });
  });

  it("stamps updatedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    try {
      const before = Date.now();
      const pin = newFreePin({ x: 0, y: 0 });

      expect(pinToText(pin, "art-1", anchor).updatedAt).toBeGreaterThanOrEqual(
        before,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pinToBoard", () => {
  it("frees an anchored pin at the given point, keeping its identity", () => {
    const pin = {
      ...newAnchoredPin("art-1", anchor),
      ...FULL,
      version: 7,
      id: "pin-2",
    };

    const free = pinToBoard(pin, { x: 300, y: 400 });

    expect(free.id).toBe("pin-2");
    expect(free.version).toBe(7);
    expect(free.board).toEqual({ x: 300, y: 400 });
    expect(isAnchoredPin(free)).toBe(false);
  });

  it("drops the quote along with the anchor", () => {
    const pin = newAnchoredPin("art-1", anchor);

    const free = pinToBoard(pin, { x: 0, y: 0 });

    expect("anchor" in free).toBe(false);
    expect("articleId" in free).toBe(false);
  });

  it("drops a mark's picture and fraction", () => {
    const free = pinToBoard(newImagePin("img-1", { u: 0.25, v: 0.8 }), {
      x: 0,
      y: 0,
    });

    expect("imageId" in free).toBe(false);
    expect("spot" in free).toBe(false);
  });

  it("carries every shared column across", () => {
    const pin = { ...newAnchoredPin("art-1", anchor), ...FULL };

    const free = pinToBoard(pin, { x: 0, y: 0 });

    for (const [key, value] of Object.entries(FULL)) {
      expect(free[key as keyof EntityBase], key).toEqual(value);
    }
  });
});

describe("pinToImage", () => {
  it("sticks a pin onto a picture, keeping its identity", () => {
    const pin = {
      ...newFreePin({ x: 10, y: 20 }),
      ...FULL,
      version: 4,
      id: "pin-3",
    };

    const marked = pinToImage(pin, "img-1", { u: 0.25, v: 0.8 });

    expect(marked.id).toBe("pin-3");
    expect(marked.version).toBe(4);
    expect(marked.imageId).toBe("img-1");
    expect(marked.spot).toEqual({ u: 0.25, v: 0.8 });
    expect(isImagePin(marked)).toBe(true);
  });

  it("carries every shared column across", () => {
    const pin = { ...newFreePin({ x: 0, y: 0 }), ...FULL };

    const marked = pinToImage(pin, "img-1", { u: 0, v: 0 });

    for (const [key, value] of Object.entries(FULL)) {
      expect(marked[key as keyof EntityBase], key).toEqual(value);
    }
  });

  it("drops the old board position rather than keeping both placements", () => {
    const marked = pinToImage(newFreePin({ x: 10, y: 20 }), "img-1", {
      u: 0.5,
      v: 0.5,
    });

    expect("board" in marked).toBe(false);
    expect("anchor" in marked).toBe(false);
  });

  it("drops the quote and the anchor it was pinned to", () => {
    const marked = pinToImage(newAnchoredPin("art-1", anchor), "img-1", {
      u: 0.5,
      v: 0.5,
    });

    expect("anchor" in marked).toBe(false);
    expect("articleId" in marked).toBe(false);
  });

  it("clamps a spot onto the picture", () => {
    const marked = pinToImage(newFreePin({ x: 0, y: 0 }), "img-1", {
      u: 2,
      v: -1,
    });

    expect(marked.spot).toEqual({ u: 1, v: 0 });
  });

  it("clears the nudge, which was measured against the old home", () => {
    const pin = { ...newFreePin({ x: 0, y: 0 }), nudge: { x: 40, y: -12 } };

    expect(pinToImage(pin, "img-1", { u: 0, v: 0 }).nudge).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("sameAnchor", () => {
  it("is true for the identical passage", () => {
    expect(sameAnchor(anchor, { ...anchor })).toBe(true);
  });

  it("is false when the words differ", () => {
    expect(sameAnchor(anchor, { ...anchor, quote: "ledger" })).toBe(false);
  });

  it("is false for the same word in a different place", () => {
    const elsewhere = {
      ...anchor,
      quote: "the",
      startOffset: 900,
      endOffset: 903,
    };
    const alsoThe = {
      ...anchor,
      quote: "the",
      startOffset: 120,
      endOffset: 123,
    };

    expect(sameAnchor(elsewhere, alsoThe)).toBe(false);
  });
});
