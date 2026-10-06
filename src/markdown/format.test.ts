import { describe, expect, it } from "vitest";

import {
  applyMarkdownAction,
  detectLinePrefix,
  isWrapped,
  replaceRange,
} from "./format";

const all = (text: string) => [0, text.length] as const;

describe("applyMarkdownAction — wrapping", () => {
  it("wraps a selection in bold", () => {
    const result = applyMarkdownAction("ferryman", ...all("ferryman"), "bold");
    expect(result.text).toBe("**ferryman**");
  });

  it("keeps the words selected after wrapping", () => {
    const result = applyMarkdownAction("ferryman", ...all("ferryman"), "bold");
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe(
      "ferryman",
    );
  });

  it("toggles bold off when the selection is already wrapped", () => {
    const result = applyMarkdownAction(
      "**ferryman**",
      ...all("**ferryman**"),
      "bold",
    );
    expect(result.text).toBe("ferryman");
  });

  it("unwraps when the selection sits inside the markers", () => {
    const text = "**ferryman**";
    const result = applyMarkdownAction(text, 2, 10, "bold");
    expect(result.text).toBe("ferryman");
  });

  it("round-trips: bold then bold again returns the original", () => {
    const original = "Molgar paid the ferryman.";
    const first = applyMarkdownAction(original, 15, 23, "bold");
    const second = applyMarkdownAction(
      first.text,
      first.selectionStart,
      first.selectionEnd,
      "bold",
    );
    expect(second.text).toBe(original);
  });

  it("handles a collapsed caret by inserting a placeholder and selecting it", () => {
    const result = applyMarkdownAction("a  b", 2, 2, "bold");
    expect(result.text).toBe("a **bold text** b");
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe(
      "bold text",
    );
  });

  for (const [action, expected] of [
    ["italic", "*x*"],
    ["strikethrough", "~~x~~"],
    ["code", "`x`"],
  ] as const) {
    it(`wraps in ${action} markers`, () => {
      expect(applyMarkdownAction("x", 0, 1, action).text).toBe(expected);
    });
  }
});

describe("applyMarkdownAction — links", () => {
  it("uses the selection as the label and selects the url", () => {
    const result = applyMarkdownAction("see Saltmarsh", 4, 13, "link");
    expect(result.text).toBe("see [Saltmarsh](url)");
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe(
      "url",
    );
  });

  it("inserts a placeholder label when nothing is selected", () => {
    const result = applyMarkdownAction("", 0, 0, "link");
    expect(result.text).toBe("[link text](url)");
  });

  it("selects the url of an existing link rather than nesting a new one", () => {
    const text = "[Saltmarsh](https://example.com)";
    const result = applyMarkdownAction(text, ...all(text), "link");
    expect(result.text).toBe(text);
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe(
      "https://example.com",
    );
  });
});

describe("applyMarkdownAction — lines", () => {
  it("turns a line into a heading", () => {
    const result = applyMarkdownAction(
      "Session Twelve",
      ...all("Session Twelve"),
      "heading",
    );
    expect(result.text).toBe("# Session Twelve");
  });

  it("toggles the heading off again", () => {
    const result = applyMarkdownAction(
      "# Session Twelve",
      ...all("# Session Twelve"),
      "heading",
    );
    expect(result.text).toBe("Session Twelve");
  });

  it("bullets every line the selection touches", () => {
    const text = "one\ntwo\nthree";
    const result = applyMarkdownAction(text, 0, text.length, "bullet");
    expect(result.text).toBe("- one\n- two\n- three");
  });

  it("numbers ordered lists sequentially", () => {
    const text = "one\ntwo\nthree";
    const result = applyMarkdownAction(text, 0, text.length, "ordered");
    expect(result.text).toBe("1. one\n2. two\n3. three");
  });

  it("quotes every line", () => {
    const text = "one\ntwo";
    const result = applyMarkdownAction(text, 0, text.length, "quote");
    expect(result.text).toBe("> one\n> two");
  });

  it("completes a partially-prefixed block rather than stripping it", () => {
    const text = "- one\ntwo\n- three";
    const result = applyMarkdownAction(text, 0, text.length, "bullet");
    expect(result.text).toBe("- one\n- two\n- three");
  });

  it("strips the whole block when every line is already prefixed", () => {
    const text = "- one\n- two";
    const result = applyMarkdownAction(text, 0, text.length, "bullet");
    expect(result.text).toBe("one\ntwo");
  });

  it("applies to the whole line even when only part of it is selected", () => {
    const text = "Session Twelve";
    const result = applyMarkdownAction(text, 2, 5, "heading");
    expect(result.text).toBe("# Session Twelve");
  });

  it("only touches the lines the selection spans", () => {
    const text = "before\nmiddle\nafter";
    const result = applyMarkdownAction(text, 7, 13, "bullet");
    expect(result.text).toBe("before\n- middle\nafter");
  });

  it("leaves blank lines alone rather than prefixing them", () => {
    const text = "one\n\ntwo";
    const result = applyMarkdownAction(text, 0, text.length, "bullet");
    expect(result.text).toBe("- one\n\n- two");
  });

  it("recognizes any list marker when toggling", () => {
    const result = applyMarkdownAction("* one", ...all("* one"), "bullet");
    expect(result.text).toBe("one");
  });

  it("promotes a bullet to a heading without leaving the dash", () => {
    const result = applyMarkdownAction(
      "- Session",
      ...all("- Session"),
      "heading",
    );
    expect(result.text).toBe("# - Session");
  });
});

describe("applyMarkdownAction — selection handling", () => {
  it("normalizes a reversed selection", () => {
    const result = applyMarkdownAction("ferryman", 8, 0, "bold");
    expect(result.text).toBe("**ferryman**");
  });

  it("clamps an out-of-range selection instead of producing undefined", () => {
    const result = applyMarkdownAction("abc", -5, 99, "bold");
    expect(result.text).toBe("**abc**");
  });

  it("handles an empty document", () => {
    const result = applyMarkdownAction("", 0, 0, "heading");
    expect(result.text).toBe("# Heading");
  });
});

describe("detectLinePrefix", () => {
  it("reports the marker a line carries", () => {
    expect(detectLinePrefix("# Heading")).toBe("heading");
    expect(detectLinePrefix("- item")).toBe("bullet");
    expect(detectLinePrefix("1. item")).toBe("ordered");
    expect(detectLinePrefix("> quote")).toBe("quote");
  });

  it("returns null for an unmarked line", () => {
    expect(detectLinePrefix("plain text")).toBeNull();
  });

  it("does not mistake a hyphenated word for a bullet", () => {
    expect(detectLinePrefix("-well")).toBeNull();
  });
});

describe("isWrapped", () => {
  it("is true for a selection sitting inside its markers", () => {
    expect(isWrapped("**ferryman**", 2, 10, "bold")).toBe(true);
  });

  it("is true when the markers are inside the selection", () => {
    expect(isWrapped("**ferryman**", 0, 12, "bold")).toBe(true);
  });

  it("is false for plain text", () => {
    expect(isWrapped("ferryman", 0, 8, "bold")).toBe(false);
  });

  it("is false when only one side is marked", () => {
    expect(isWrapped("**ferryman", 2, 10, "bold")).toBe(false);
  });

  it("is false for a line action, which has no wrapping markers", () => {
    expect(isWrapped("# Heading", 0, 9, "heading")).toBe(false);
  });
});

describe("replacing a range", () => {
  it("puts the insertion where the range was and the caret after it", () => {
    const result = replaceRange(
      "See @Bell about it",
      4,
      9,
      "@[The Drowned Bell]",
    );

    expect(result.text).toBe("See @[The Drowned Bell] about it");
    expect(result.selectionStart).toBe("See @[The Drowned Bell]".length);
    expect(result.selectionEnd).toBe(result.selectionStart);
  });

  it("inserts rather than replaces when the range is empty", () => {
    const result = replaceRange("ab", 1, 1, "X");
    expect(result.text).toBe("aXb");
    expect(result.selectionStart).toBe(2);
  });

  it("clamps a range that runs off either end", () => {
    expect(replaceRange("abc", -5, 99, "Z").text).toBe("Z");
  });

  it("normalizes a backwards selection", () => {
    expect(replaceRange("abcdef", 4, 1, "-").text).toBe("a-ef");
  });
});
