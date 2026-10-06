import { describe, expect, it } from "vitest";

import {
  ARTICLE_PAPERS,
  ARTICLE_TYPE_SCALES,
  ARTICLE_WIDTHS,
  DEFAULT_ARTICLE_OPTIONS,
  parseArticleOptions,
} from "./article-options";

describe("parseArticleOptions", () => {
  it("passes valid options through unchanged", () => {
    const options = {
      width: 960,
      typeScale: "large",
      paper: "grey",
      titleBar: false,
      editable: false,
      acceptsPins: false,
      collapsible: true,
      collapsed: true,
    } as const;
    expect(parseArticleOptions(options)).toEqual(options);
  });

  it("round-trips the defaults", () => {
    expect(parseArticleOptions(DEFAULT_ARTICLE_OPTIONS)).toEqual(
      DEFAULT_ARTICLE_OPTIONS,
    );
  });

  it("falls back field by field, so one bad value costs only itself", () => {
    const parsed = parseArticleOptions({
      width: "huge",
      paper: "grey",
      editable: false,
    });
    expect(parsed.width).toBe(DEFAULT_ARTICLE_OPTIONS.width);
    expect(parsed.paper).toBe("grey");
    expect(parsed.editable).toBe(false);
  });

  it("is total — every hostile input yields usable options", () => {
    const hostile: unknown[] = [
      undefined,
      null,
      0,
      "",
      "nonsense",
      [],
      [1, 2],
      () => {},
      Symbol("x"),
      { width: NaN, typeScale: Infinity, paper: {}, titleBar: "yes" },
    ];
    for (const input of hostile) {
      const parsed = parseArticleOptions(input);
      expect(ARTICLE_WIDTHS).toContain(parsed.width);
      expect(ARTICLE_TYPE_SCALES).toContain(parsed.typeScale);
      expect(ARTICLE_PAPERS).toContain(parsed.paper);
      for (const flag of [
        parsed.titleBar,
        parsed.editable,
        parsed.acceptsPins,
        parsed.collapsible,
        parsed.collapsed,
      ]) {
        expect(typeof flag).toBe("boolean");
      }
    }
  });

  it("keeps a width the presets do not offer", () => {
    expect(parseArticleOptions({ width: 721 }).width).toBe(721);
  });

  it("refuses a width that is not a width", () => {
    for (const nonsense of [
      0,
      -720,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "720",
    ]) {
      expect(parseArticleOptions({ width: nonsense }).width).toBe(
        DEFAULT_ARTICLE_OPTIONS.width,
      );
    }
  });

  it("ignores unknown keys rather than smuggling them into state", () => {
    const parsed = parseArticleOptions({ width: 480, evil: "payload" });
    expect(parsed).not.toHaveProperty("evil");
  });

  it("never shares mutable structure with its input", () => {
    const source = { width: 480 };
    const parsed = parseArticleOptions(source);
    parsed.width = 960;
    expect(source.width).toBe(480);
  });
});
