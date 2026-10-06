import { describe, expect, it } from "vitest";

import {
  anchorOnBox,
  controlPoint,
  distance,
  distanceToYarn,
  MAX_SAG_RATIO,
  MAX_SLACK,
  pointOnYarn,
  sagFor,
  slackForSag,
  yarnPath,
} from "./yarn";

describe("sagFor", () => {
  it("does not sag a string with no slack", () => {
    expect(sagFor(400, 0)).toBe(0);
  });

  it("does not sag a zero-length string", () => {
    expect(sagFor(0, 0.2)).toBe(0);
  });

  it("grows with the square root of slack, not linearly", () => {
    const tight = sagFor(400, 0.05);
    const loose = sagFor(400, 0.2);
    const veryLoose = sagFor(400, 0.8);

    expect(loose / tight).toBeGreaterThan(1.5);
    expect(loose / tight).toBeLessThan(2.5);
    expect(veryLoose / loose).toBeGreaterThan(1.5);
    expect(veryLoose / loose).toBeLessThan(2.5);
  });

  it("sags further on a longer span, for the same proportional slack", () => {
    expect(sagFor(800, 0.2)).toBeGreaterThan(sagFor(400, 0.2));
  });

  it("caps sag so a long string cannot balloon off the board", () => {
    const capped = sagFor(1000, 10);
    expect(capped).toBeLessThanOrEqual(1000 * 0.55);
  });
});

describe("slackForSag", () => {
  // Exact inverses, or a drag would creep as slack is re-derived each step.
  it("round-trips sagFor exactly", () => {
    for (const gap of [40, 200, 600, 900]) {
      for (const slack of [0, 0.02, 0.18, 0.4, 0.8]) {
        const sag = sagFor(gap, slack);
        expect(sagFor(gap, slackForSag(gap, sag))).toBeCloseTo(sag, 9);
      }
    }
  });

  it("is scale-free, so the same droop is the same slack at any span", () => {
    expect(slackForSag(200, 40)).toBeCloseTo(slackForSag(600, 120), 12);
  });

  it("treats a negative sag, and no span, as no sag", () => {
    expect(slackForSag(400, -50)).toBe(0);
    expect(slackForSag(0, 100)).toBe(0);
  });

  it("reaches MAX_SLACK exactly where the sag cap bites", () => {
    expect(MAX_SLACK).toBeCloseTo(slackForSag(500, 500 * MAX_SAG_RATIO), 12);
    expect(sagFor(500, MAX_SLACK)).toBeCloseTo(500 * MAX_SAG_RATIO, 9);
    expect(sagFor(500, MAX_SLACK * 4)).toBeCloseTo(500 * MAX_SAG_RATIO, 9);
  });
});

describe("controlPoint", () => {
  it("sits at the midpoint horizontally", () => {
    const control = controlPoint({ x: 0, y: 0 }, { x: 200, y: 0 });
    expect(control.x).toBe(100);
  });

  it("hangs below the chord", () => {
    const control = controlPoint({ x: 0, y: 0 }, { x: 200, y: 0 });
    expect(control.y).toBeGreaterThan(0);
  });

  it("hangs below even when the chord is not horizontal", () => {
    // Sag is gravity: always +y regardless of the string's direction.
    const control = controlPoint({ x: 0, y: 0 }, { x: 100, y: -300 });
    const chordMidpoint = { x: 50, y: -150 };
    expect(control.y).toBeGreaterThan(chordMidpoint.y);
  });
});

describe("yarnPath", () => {
  it("produces a quadratic path between the two points", () => {
    const path = yarnPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 0);
    expect(path).toBe("M 0 0 Q 50 0 100 0");
  });

  it("rounds to two decimals rather than emitting float noise", () => {
    const path = yarnPath({ x: 0.123456, y: 0 }, { x: 100.987654, y: 0 }, 0);
    expect(path).toBe("M 0.12 0 Q 50.56 0 100.99 0");
  });
});

describe("pointOnYarn", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 200, y: 0 };

  it("starts and ends at the endpoints", () => {
    expect(pointOnYarn(from, to, 0)).toEqual({ x: 0, y: 0 });
    expect(pointOnYarn(from, to, 1)).toEqual({ x: 200, y: 0 });
  });

  it("hangs at its lowest at the midpoint", () => {
    const quarter = pointOnYarn(from, to, 0.25);
    const middle = pointOnYarn(from, to, 0.5);
    const threeQuarters = pointOnYarn(from, to, 0.75);

    expect(middle.y).toBeGreaterThan(quarter.y);
    expect(middle.y).toBeGreaterThan(threeQuarters.y);
    expect(quarter.y).toBeCloseTo(threeQuarters.y, 6);
  });

  it("is symmetric about the midpoint", () => {
    const left = pointOnYarn(from, to, 0.3);
    const right = pointOnYarn(from, to, 0.7);
    expect(left.y).toBeCloseTo(right.y, 6);
    expect(left.x + right.x).toBeCloseTo(200, 6);
  });
});

describe("distanceToYarn", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 200, y: 0 };

  it("reports zero on the curve", () => {
    const onCurve = pointOnYarn(from, to, 0.5);
    const result = distanceToYarn(from, to, onCurve);
    expect(result.distance).toBeLessThan(1);
  });

  it("measures to the curve between samples, not to the samples", () => {
    // Half a chord on a long string is tens of px — wider than the grab a hover uses, so
    // measuring to the nearest sample would make a hover land and then miss.
    const between = pointOnYarn(
      { x: 0, y: 0 },
      { x: 1200, y: 0 },
      0.5 + 0.5 / 24,
      0.3,
    );
    const result = distanceToYarn(
      { x: 0, y: 0 },
      { x: 1200, y: 0 },
      between,
      0.3,
      24,
    );
    expect(result.distance).toBeLessThan(1);
  });

  it("lets a click near a string select it", () => {
    const nearCurve = pointOnYarn(from, to, 0.5);
    const result = distanceToYarn(from, to, {
      x: nearCurve.x,
      y: nearCurve.y + 4,
    });
    expect(result.distance).toBeLessThan(8);
  });

  it("returns the parameter of the nearest point so callers can act on it", () => {
    const nearQuarter = pointOnYarn(from, to, 0.25);
    const result = distanceToYarn(from, to, nearQuarter, 0.18, 200);
    expect(result.t).toBeGreaterThan(0.2);
    expect(result.t).toBeLessThan(0.3);
  });

  it("measures a real distance for a point far away", () => {
    const result = distanceToYarn(from, to, { x: 100, y: 5000 });
    expect(result.distance).toBeGreaterThan(4000);
  });
});

describe("anchorOnBox", () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };

  it("attaches to the nearest edge, not the centre", () => {
    const right = anchorOnBox(box, { x: 1000, y: 50 });
    expect(right).toEqual({ x: 100, y: 50 });

    const bottom = anchorOnBox(box, { x: 50, y: 1000 });
    expect(bottom).toEqual({ x: 50, y: 100 });
  });

  it("handles a diagonal target on whichever edge it exits", () => {
    const corner = anchorOnBox(box, { x: 1000, y: 1000 });
    expect(corner.x).toBeCloseTo(100, 6);
    expect(corner.y).toBeCloseTo(100, 6);
  });

  it("returns the centre when the target is the centre", () => {
    expect(anchorOnBox(box, { x: 50, y: 50 })).toEqual({ x: 50, y: 50 });
  });

  it("always lands on the box boundary", () => {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
      const target = {
        x: 50 + Math.cos(angle) * 500,
        y: 50 + Math.sin(angle) * 500,
      };
      const point = anchorOnBox(box, target);
      const onEdge =
        point.x === 0 || point.x === 100 || point.y === 0 || point.y === 100;
      expect(onEdge, `angle ${angle} produced ${JSON.stringify(point)}`).toBe(
        true,
      );
    }
  });
});

describe("distance", () => {
  it("measures a 3-4-5 triangle", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
