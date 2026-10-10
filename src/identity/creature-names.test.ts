import { describe, expect, it } from "vitest";

import { anonymousName, CREATURES, nextReroll } from "./creature-names";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const THEM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("anonymousName", () => {
  it("names an anonymous person a capitalised creature", () => {
    const name = anonymousName(ME);
    expect(name.startsWith("Anonymous ")).toBe(true);
    expect(CREATURES).toContain(name.slice("Anonymous ".length).toLowerCase());
  });

  it("gives the same person the same creature every time", () => {
    expect(anonymousName(ME)).toBe(anonymousName(ME));
    expect(anonymousName(ME)).not.toBe(anonymousName(THEM));
  });
});

describe("nextReroll", () => {
  it("lands on a creature that is not the one you have", () => {
    expect(anonymousName(ME, nextReroll(ME, 0))).not.toBe(anonymousName(ME, 0));
  });

  it("always changes, from any count and for any id", () => {
    for (const id of [ME, THEM, "not-a-uuid", ""]) {
      for (let from = 0; from < 64; from += 1) {
        expect(anonymousName(id, nextReroll(id, from))).not.toBe(
          anonymousName(id, from),
        );
      }
    }
  });
});
