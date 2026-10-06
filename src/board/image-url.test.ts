// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { isHttpImageSrc } from "../model/image-src";
import { linkFrom, measure, nameFromUrl } from "./image-url";

/** jsdom's Image never fires either event, so the probe has to be stood up. */
function stubImage(behaviour: "load" | "error" | "silent") {
  const original = globalThis.Image;
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 320;
    naturalHeight = 240;
    set src(_value: string) {
      if (behaviour === "load") queueMicrotask(() => this.onload?.());
      if (behaviour === "error") queueMicrotask(() => this.onerror?.());
    }
  }
  globalThis.Image = FakeImage as unknown as typeof Image;
  return () => {
    globalThis.Image = original;
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("what counts as a link", () => {
  it("takes http and https", () => {
    expect(isHttpImageSrc("https://example.com/a.png")).toBe(true);
    expect(isHttpImageSrc("http://example.com/a.png")).toBe(true);
  });

  it("refuses anything that is not one, including a stored copy", () => {
    expect(isHttpImageSrc("data:image/png;base64,AAAA")).toBe(false);
    expect(isHttpImageSrc("blob:http://localhost/abc")).toBe(false);
    expect(isHttpImageSrc("/pictures/a.png")).toBe(false);
    expect(isHttpImageSrc("")).toBe(false);
  });

  it("refuses a link long enough to be a payload", () => {
    expect(isHttpImageSrc(`https://example.com/${"a".repeat(5000)}`)).toBe(false);
  });
});

describe("finding the link in a drop or paste", () => {
  const data = (values: Record<string, string>) =>
    ({ getData: (type: string) => values[type] ?? "" }) as DataTransfer;

  it("reads a uri list", () => {
    expect(linkFrom(data({ "text/uri-list": "https://example.com/a.png" }))).toBe(
      "https://example.com/a.png",
    );
  });

  it("skips the comments a uri list may carry", () => {
    const list = "# dragged from the web\nhttps://example.com/a.png\n";
    expect(linkFrom(data({ "text/uri-list": list }))).toBe(
      "https://example.com/a.png",
    );
  });

  it("falls back to plain text", () => {
    expect(linkFrom(data({ "text/plain": "  https://x.test/b.jpg  " }))).toBe(
      "https://x.test/b.jpg",
    );
  });

  it("ignores text that is not a link", () => {
    expect(linkFrom(data({ "text/plain": "some words" }))).toBeNull();
    expect(linkFrom(data({ "text/plain": "data:image/png;base64,AA" }))).toBeNull();
  });

  it("has nothing for a drop that carried nothing", () => {
    expect(linkFrom(null)).toBeNull();
  });
});

describe("naming a linked picture", () => {
  it("uses the last segment of the path", () => {
    expect(nameFromUrl("https://example.com/maps/salt-marsh.png")).toBe(
      "salt-marsh.png",
    );
  });

  it("decodes an escaped name, and copes with a bare host", () => {
    expect(nameFromUrl("https://example.com/a%20map.png")).toBe("a map.png");
    expect(nameFromUrl("https://example.com")).toBe("Linked picture");
  });
});

describe("measuring a linked picture", () => {
  it("gives the natural size once it loads", async () => {
    const restore = stubImage("load");
    try {
      await expect(measure("https://example.com/a.png")).resolves.toEqual({
        width: 320,
        height: 240,
      });
    } finally {
      restore();
    }
  });

  it("refuses a picture that will not load", async () => {
    const restore = stubImage("error");
    try {
      await expect(measure("https://example.com/missing.png")).rejects.toThrow();
    } finally {
      restore();
    }
  });

  it("gives up rather than waiting on a host that never answers", async () => {
    vi.useFakeTimers();
    const restore = stubImage("silent");
    try {
      const pending = measure("https://example.com/slow.png", 50);
      const settled = expect(pending).rejects.toThrow(/in time/);
      await vi.advanceTimersByTimeAsync(60);
      await settled;
    } finally {
      restore();
    }
  });
});
