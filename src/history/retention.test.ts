import { describe, expect, it } from "vitest";

import { DAILY_KEEP_MS, HOUR_MS, planRecord, survivors } from "./retention";

const DAY = 24 * HOUR_MS;
/** Days as plain numbers, so the tests do not depend on the machine's time zone. */
const dayOf = (at: number) => String(Math.floor(at / DAY));
const NOW = 100 * DAY + 10 * HOUR_MS;

const at = (takenAt: number, id = String(takenAt)) => ({ id, takenAt });
const ids = (list: { id: string }[]) => list.map((each) => each.id).sort();

describe("survivors", () => {
  it("keeps every snapshot from the last 24 hours", () => {
    const hourly = Array.from({ length: 24 }, (_, n) => at(NOW - n * HOUR_MS));
    expect(survivors(hourly, NOW, dayOf)).toHaveLength(24);
  });

  it("keeps only the last snapshot of each older day", () => {
    const morning = at(98 * DAY + 8 * HOUR_MS, "morning");
    const evening = at(98 * DAY + 20 * HOUR_MS, "evening");
    const newest = at(NOW, "newest");

    expect(ids(survivors([morning, evening, newest], NOW, dayOf))).toEqual([
      "evening",
      "newest",
    ]);
  });

  it("keeps a day's last snapshot even while it is still inside the hourly window", () => {
    // Yesterday 20:00 is within 24 hours of today 10:00; yesterday 05:00 is not.
    const early = at(99 * DAY + 5 * HOUR_MS, "early");
    const late = at(99 * DAY + 20 * HOUR_MS, "late");
    expect(ids(survivors([early, late], NOW, dayOf))).toEqual(["late"]);
  });

  it("drops days older than 30, but never the newest snapshot", () => {
    const old = at(NOW - DAILY_KEEP_MS - DAY, "old");
    const recent = at(NOW - 2 * DAY, "recent");
    expect(ids(survivors([old, recent], NOW, dayOf))).toEqual(["recent"]);
    expect(ids(survivors([old], NOW, dayOf))).toEqual(["old"]);
  });
});

describe("planRecord", () => {
  it("starts a history only for a board with something on it", () => {
    expect(planRecord(null, NOW, true, true)).toBe("skip");
    expect(planRecord(null, NOW, true, false)).toBe("add");
  });

  it("writes nothing when the board has not changed", () => {
    expect(planRecord({ takenAt: NOW - 5 * HOUR_MS }, NOW, false, false)).toBe(
      "skip",
    );
  });

  it("saves at most one version an hour", () => {
    const thisHour = Math.floor(NOW / HOUR_MS) * HOUR_MS;
    expect(planRecord({ takenAt: thisHour + 1 }, NOW, true, false)).toBe(
      "skip",
    );
    expect(planRecord({ takenAt: thisHour - 1 }, NOW, true, false)).toBe("add");
  });
});
