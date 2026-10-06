import { describe, expect, it } from "vitest";

import { MAX_EDGE, MIN_EDGE, sizeFor } from "./ImageCard";
import { rotateAbout } from "./pivot";

const start = { width: 240, height: 120 };
const pivot = { x: 0, y: 0 };

describe("sizeFor", () => {
  it("leaves the picture alone when the corner has not moved", () => {
    expect(sizeFor(pivot, { x: 120, y: 120 }, 0, start)).toEqual(start);
  });

  it("grows as the corner is pulled away from the pin", () => {
    const bigger = sizeFor(pivot, { x: 240, y: 240 }, 0, start);

    expect(bigger.width).toBe(480);
    expect(bigger.height).toBe(240);
  });

  it("shrinks as the corner is pushed back toward the pin", () => {
    const smaller = sizeFor(pivot, { x: 60, y: 60 }, 0, start);

    expect(smaller.width).toBe(120);
    expect(smaller.height).toBe(60);
  });

  it("keeps shrinking when the corner is dragged past the pin", () => {
    const past = sizeFor(pivot, { x: -240, y: -240 }, 0, start);

    expect(past.width).toBe(MIN_EDGE);
    expect(past.height).toBe(MIN_EDGE / 2);
  });

  it("holds at the floor rather than collapsing to nothing", () => {
    expect(sizeFor(pivot, { x: 0, y: 0 }, 0, start).width).toBe(MIN_EDGE);
  });

  it("holds at the ceiling", () => {
    expect(sizeFor(pivot, { x: 100000, y: 100000 }, 0, start).width).toBe(
      MAX_EDGE,
    );
  });

  it("keeps the shape the picture arrived with", () => {
    for (const pointer of [
      { x: 300, y: 90 },
      { x: 60, y: 300 },
      { x: 500, y: 500 },
    ]) {
      const size = sizeFor(pivot, pointer, 0, start);
      expect(size.width / size.height, JSON.stringify(pointer)).toBeCloseTo(
        2,
        6,
      );
    }
  });

  it("reads the drag in the sheet own frame when it is tilted", () => {
    const corner = { x: 120, y: 120 };
    const onScreen = rotateAbout(pivot, corner, 45);
    const tilted = sizeFor(pivot, onScreen, 45, start);

    expect(tilted.width).toBeCloseTo(240, 6);
    expect(tilted.height).toBeCloseTo(120, 6);
  });

  it("is unaffected by which way the sheet leans", () => {
    const corner = { x: 200, y: 200 };
    const left = sizeFor(pivot, rotateAbout(pivot, corner, -45), -45, start);
    const right = sizeFor(pivot, rotateAbout(pivot, corner, 45), 45, start);

    expect(left).toEqual(right);
  });
});
