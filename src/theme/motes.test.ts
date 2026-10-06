import { describe, expect, it } from "vitest";

import {
  candleFlicker,
  createMotes,
  moteOpacity,
  moteScreenPosition,
  mulberry32,
  stepMotes,
  type Bounds,
} from "./motes";

const bounds: Bounds = { width: 800, height: 600 };

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it("produces different streams from different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const differs = Array.from({ length: 20 }, () => a() !== b()).some(Boolean);
    expect(differs).toBe(true);
  });

  it("stays within [0, 1)", () => {
    const random = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("createMotes", () => {
  it("creates the requested number", () => {
    expect(createMotes(24, bounds, 1)).toHaveLength(24);
  });

  it("handles zero", () => {
    expect(createMotes(0, bounds, 1)).toEqual([]);
  });

  it("is stable across calls with the same seed", () => {
    const a = createMotes(12, bounds, 99);
    const b = createMotes(12, bounds, 99);
    expect(a).toEqual(b);
  });

  it("places every mote inside the bounds", () => {
    for (const mote of createMotes(100, bounds, 3)) {
      expect(mote.x).toBeGreaterThanOrEqual(0);
      expect(mote.x).toBeLessThanOrEqual(bounds.width);
      expect(mote.y).toBeGreaterThanOrEqual(0);
      expect(mote.y).toBeLessThanOrEqual(bounds.height);
    }
  });

  it("varies radius and opacity rather than making a uniform field", () => {
    const motes = createMotes(60, bounds, 5);
    const radii = new Set(motes.map((m) => m.radius.toFixed(3)));
    expect(radii.size).toBeGreaterThan(10);

    const alphas = motes.map((m) => m.alpha);
    expect(Math.max(...alphas) - Math.min(...alphas)).toBeGreaterThan(0.05);
  });

  it("biases towards small motes", () => {
    const motes = createMotes(400, bounds, 11, { minRadius: 0, maxRadius: 4 });
    const mean = motes.reduce((sum, m) => sum + m.radius, 0) / motes.length;
    // Squaring puts the mean near a third of the range, not the midpoint.
    expect(mean).toBeLessThan(2);
  });

  it("gives motes out-of-phase shimmer", () => {
    const phases = new Set(
      createMotes(30, bounds, 13).map((m) => m.phase.toFixed(4)),
    );
    expect(phases.size).toBeGreaterThan(20);
  });
});

describe("stepMotes", () => {
  it("moves the field", () => {
    const motes = createMotes(20, bounds, 1);
    const before = motes.map((m) => ({ x: m.x, y: m.y }));
    for (let i = 0; i < 30; i++) stepMotes(motes, 1 / 60, bounds);
    const moved = motes.some(
      (m, i) => m.x !== before[i].x || m.y !== before[i].y,
    );
    expect(moved).toBe(true);
  });

  it("keeps every mote inside the bounds by wrapping", () => {
    const motes = createMotes(50, bounds, 2);
    for (let i = 0; i < 600; i++) stepMotes(motes, 1 / 60, bounds);
    for (const mote of motes) {
      expect(mote.x).toBeGreaterThanOrEqual(0);
      expect(mote.x).toBeLessThanOrEqual(bounds.width);
      expect(mote.y).toBeGreaterThanOrEqual(0);
      expect(mote.y).toBeLessThanOrEqual(bounds.height);
    }
  });

  it("never changes the mote count", () => {
    const motes = createMotes(15, bounds, 4);
    for (let i = 0; i < 200; i++) stepMotes(motes, 1 / 60, bounds);
    expect(motes).toHaveLength(15);
  });

  it("does not let the random walk accumulate into streaking", () => {
    const motes = createMotes(30, bounds, 6);
    for (let i = 0; i < 3000; i++) stepMotes(motes, 1 / 60, bounds);
    for (const mote of motes) {
      expect(Math.abs(mote.vx)).toBeLessThan(200);
      expect(Math.abs(mote.vy)).toBeLessThan(200);
    }
  });

  it("survives an enormous frame without teleporting the field", () => {
    // A backgrounded tab waking up hands the loop a multi-second dt.
    const motes = createMotes(20, bounds, 8);
    const before = motes.map((m) => ({ x: m.x, y: m.y }));
    stepMotes(motes, 12, bounds);
    motes.forEach((mote, i) => {
      // Clamped to 1/20s of travel, so nothing crosses the board.
      expect(Math.abs(mote.x - before[i].x)).toBeLessThan(bounds.width);
      expect(Number.isFinite(mote.x)).toBe(true);
    });
  });

  it("drifts downwards on average", () => {
    const motes = createMotes(40, bounds, 9);
    const meanBefore = motes.reduce((sum, m) => sum + m.y, 0) / motes.length;
    for (let i = 0; i < 120; i++) stepMotes(motes, 1 / 60, bounds);
    const meanAfter = motes.reduce((sum, m) => sum + m.y, 0) / motes.length;
    expect(meanAfter).toBeGreaterThan(meanBefore);
  });
});

describe("moteOpacity", () => {
  it("stays positive", () => {
    const motes = createMotes(10, bounds, 1);
    for (let t = 0; t < 20; t += 0.1) {
      for (const mote of motes)
        expect(moteOpacity(mote, t)).toBeGreaterThanOrEqual(0);
    }
  });

  it("shimmers rather than sitting still", () => {
    const [mote] = createMotes(1, bounds, 1);
    const samples = Array.from({ length: 40 }, (_, i) =>
      moteOpacity(mote, i * 0.3),
    );
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0);
  });

  it("keeps motes out of phase with each other", () => {
    const motes = createMotes(2, bounds, 1);
    const differences = Array.from({ length: 20 }, (_, i) =>
      Math.abs(moteOpacity(motes[0], i) - moteOpacity(motes[1], i)),
    );
    expect(Math.max(...differences)).toBeGreaterThan(0);
  });

  it("never exceeds the mote’s own alpha", () => {
    const motes = createMotes(10, bounds, 2);
    for (let t = 0; t < 10; t += 0.25) {
      for (const mote of motes) {
        expect(moteOpacity(mote, t)).toBeLessThanOrEqual(mote.alpha * 1.0001);
      }
    }
  });
});

describe("moteScreenPosition", () => {
  const identity = { x: 0, y: 0, zoom: 1 };

  it("returns the mote position unchanged with no camera movement", () => {
    const [mote] = createMotes(1, bounds, 1);
    const position = moteScreenPosition(mote, identity, bounds);
    expect(position.x).toBeCloseTo(mote.x, 6);
    expect(position.y).toBeCloseTo(mote.y, 6);
  });

  it("drifts against the camera, not with it", () => {
    const [mote] = createMotes(1, bounds, 1);
    const moved = moteScreenPosition(
      mote,
      { x: 100, y: 0, zoom: 1 },
      bounds,
      0.3,
    );
    // Parallax is a fraction of camera movement, opposite in sign.
    expect(moved.x).toBeCloseTo(
      (((mote.x - 30) % bounds.width) + bounds.width) % bounds.width,
      6,
    );
  });

  it("stays within bounds however far the board is panned", () => {
    const motes = createMotes(20, bounds, 3);
    for (const cameraX of [0, 5000, -5000, 123456]) {
      for (const mote of motes) {
        const position = moteScreenPosition(
          mote,
          { x: cameraX, y: cameraX, zoom: 1 },
          bounds,
        );
        expect(position.x).toBeGreaterThanOrEqual(0);
        expect(position.x).toBeLessThan(bounds.width);
        expect(position.y).toBeGreaterThanOrEqual(0);
        expect(position.y).toBeLessThan(bounds.height);
      }
    }
  });
});

describe("candleFlicker", () => {
  it("hovers around 1", () => {
    for (let t = 0; t < 60; t += 0.1) {
      const value = candleFlicker(t);
      expect(value).toBeGreaterThan(0.9);
      expect(value).toBeLessThan(1.1);
    }
  });

  it("actually varies", () => {
    const samples = Array.from({ length: 400 }, (_, i) =>
      candleFlicker(i * 0.05),
    );
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.02);
  });

  it("stays subtle", () => {
    const samples = Array.from({ length: 2000 }, (_, i) =>
      candleFlicker(i * 0.05),
    );
    expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(0.2);
  });

  it("does not repeat on any short period", () => {
    const start = Array.from({ length: 240 }, (_, i) =>
      candleFlicker(i * 0.05),
    );
    const later = Array.from({ length: 240 }, (_, i) =>
      candleFlicker(i * 0.05 + 40),
    );
    const identical = start.every(
      (value, i) => Math.abs(value - later[i]) < 1e-9,
    );
    expect(identical).toBe(false);
  });

  it("is continuous — no jumps between adjacent frames", () => {
    let previous = candleFlicker(0);
    for (let t = 1 / 60; t < 30; t += 1 / 60) {
      const current = candleFlicker(t);
      expect(Math.abs(current - previous)).toBeLessThan(0.01);
      previous = current;
    }
  });
});
