// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBoardRecord } from "./board-record";
import { copyTextToClipboard, shareUrlFor } from "./share";

const record = {
  ...createBoardRecord("Ledger", { entities: [], strings: [] }, 1),
  id: "abc123",
  editToken: "an-edit-token",
};
const PAGES_BASE = "/diagrams-and-dossiers";

describe("the link to a board", () => {
  it("carries the edit token, which is what opens the door", () => {
    expect(shareUrlFor(record, "https://example.test", "/")).toBe(
      "https://example.test/j/an-edit-token",
    );
  });

  it("carries the subpath the app is served from", () => {
    expect(shareUrlFor(record, "https://example.test", PAGES_BASE)).toBe(
      "https://example.test/diagrams-and-dossiers/j/an-edit-token",
    );
  });

  it("has no link to give for a board that never reached the server", () => {
    const local = createBoardRecord("Ledger", { entities: [], strings: [] }, 1);
    expect(shareUrlFor(local, "https://example.test", "/")).toBeNull();
  });
});

describe("putting text on the clipboard", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("says so when the platform has no clipboard at all", async () => {
    expect(await copyTextToClipboard("https://example.test/b/abc123")).toBe(
      false,
    );
  });

  it("reports success when the write lands", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    expect(await copyTextToClipboard("https://example.test/b/abc123")).toBe(
      true,
    );
    expect(writeText).toHaveBeenCalledWith("https://example.test/b/abc123");
  });

  it("reports failure rather than throwing when permission is refused", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    expect(await copyTextToClipboard("https://example.test/b/abc123")).toBe(
      false,
    );
  });
});
