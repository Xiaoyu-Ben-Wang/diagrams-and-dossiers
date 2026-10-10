// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { anonymousName } from "./creature-names";
import {
  IDENTITY_STORAGE_KEY,
  loadIdentity,
  nameFor,
  parseIdentity,
  saveIdentity,
  type Identity,
} from "./identity";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function storage(initial?: string): Storage {
  const held = new Map<string, string>();
  if (initial !== undefined) held.set(IDENTITY_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
  } as unknown as Storage;
}

describe("nameFor", () => {
  it("uses the chosen name when there is one", () => {
    const identity: Identity = {
      displayName: "Dungeon Master",
      anonymous: false,
    };
    expect(nameFor(identity, ME)).toBe("Dungeon Master");
  });

  it("uses the creature for an anonymous joiner", () => {
    expect(nameFor({ anonymous: true }, ME)).toBe(anonymousName(ME));
  });

  it("keeps the creature the joiner settled on", () => {
    const rerolled: Identity = { anonymous: true, rerolls: 3 };
    expect(nameFor(rerolled, ME)).toBe(anonymousName(ME, 3));
    expect(nameFor(rerolled, ME)).not.toBe(anonymousName(ME));
  });
});

describe("parseIdentity", () => {
  it("keeps how many times the name was re-rolled", () => {
    expect(parseIdentity('{"anonymous":true,"rerolls":4}').rerolls).toBe(4);
  });

  it("treats a missing or unusable count as none", () => {
    for (const raw of [
      '{"anonymous":true}',
      '{"anonymous":true,"rerolls":-2}',
      '{"anonymous":true,"rerolls":"3"}',
      "junk",
    ]) {
      expect(parseIdentity(raw).rerolls).toBe(0);
    }
  });
});

describe("load and save", () => {
  it("gets back the name and the count that were put in", () => {
    const store = storage();
    saveIdentity({ anonymous: true, rerolls: 7 }, store);
    expect(loadIdentity(store)).toEqual({
      displayName: undefined,
      anonymous: true,
      rerolls: 7,
    });
  });

  it("falls back to anonymous when what was stored is junk", () => {
    expect(loadIdentity(storage("{"))).toEqual({
      displayName: undefined,
      anonymous: true,
      rerolls: 0,
    });
  });
});
