// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  EXPORT_HIDE_SELECTORS,
  buildExportSvg,
  collectStyleText,
  prepareExportClone,
} from "./export-image-dom";

const SHADOW = "drop-shadow(0 2px 3px black)";

/** A world layer with one of everything the export has to deal with. */
function world(): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-testid", "board-world");
  element.style.transform = "translate3d(10px, 20px, 0) scale(0.5)";
  element.innerHTML = `
    <div class="parchment is-selected ring-2 ring-brass/70" data-article-id="a">
      <button data-testid="paper-tab">The Drowned Bell</button>
      <div class="post-it is-selected">
        <textarea>He named a price.</textarea>
        <div class="post-it-tools"><button class="post-it-resize"></button></div>
        <button class="post-it-close"></button>
      </div>
      <div class="image-card">
        <div class="image-shadow" style="filter: ${SHADOW} drop-shadow(0 0 3px gold)"></div>
        <button class="image-resize"></button>
      </div>
      <div class="string-note"><span class="string-note-prompt">+ note</span></div>
      <div class="string-note">
        <textarea>which of the two</textarea>
        <div class="string-note-swatches"><button class="string-note-swatch"></button></div>
      </div>
    </div>
  `;
  return element;
}

describe("preparing a clone to draw", () => {
  it("leaves the chrome out of the file", () => {
    const clone = prepareExportClone(world(), SHADOW);

    for (const selector of EXPORT_HIDE_SELECTORS) {
      expect(clone.querySelectorAll(selector).length, selector).toBe(0);
    }
  });

  it("keeps the page and its title, which are board rather than chrome", () => {
    const clone = prepareExportClone(world(), SHADOW);

    expect(clone.querySelector('[data-testid="paper-tab"]')?.textContent).toBe(
      "The Drowned Bell",
    );
  });

  it("takes the selection off everything", () => {
    const clone = prepareExportClone(world(), SHADOW);

    expect(clone.querySelector(".is-selected")).toBeNull();
    expect(clone.querySelector(".ring-2")).toBeNull();
    expect(clone.querySelector(".ring-brass\\/70")).toBeNull();
  });

  it("writes a textarea’s value in, which React keeps as a property", () => {
    const clone = prepareExportClone(world(), SHADOW);
    const field = clone.querySelector("textarea");

    expect(field?.textContent).toBe("He named a price.");
  });

  it("takes the picture’s selection rim off its shadow", () => {
    const clone = prepareExportClone(world(), SHADOW);

    expect(
      clone.querySelector<HTMLElement>(".image-shadow")?.style.filter,
    ).toBe(SHADOW);
  });

  it("drops a string note that is only offering to be written on", () => {
    const clone = prepareExportClone(world(), SHADOW);

    expect(clone.querySelectorAll(".string-note").length).toBe(1);
    expect(clone.querySelector(".string-note textarea")?.textContent).toBe(
      "which of the two",
    );
  });

  it("takes the camera transform off, since the export supplies its own", () => {
    const clone = prepareExportClone(world(), SHADOW);

    expect(clone.style.transform).toBe("");
  });

  it("does not touch the layer it copied", () => {
    const source = world();
    prepareExportClone(source, SHADOW);

    expect(source.querySelectorAll(".post-it-tools").length).toBe(1);
    expect(source.querySelector(".is-selected")).not.toBeNull();
  });
});

describe("the stylesheet", () => {
  it("is the page’s own, rule by rule", () => {
    const style = document.createElement("style");
    style.textContent = ".a { color: red } .b { color: blue }";
    document.head.appendChild(style);

    expect(collectStyleText()).toContain(".a {color: red;}");
    style.remove();
  });

  it("skips a sheet it is not allowed to read rather than throwing", () => {
    const fake = {
      get cssRules(): CSSRuleList {
        throw new Error("cross-origin");
      },
    } as unknown as StyleSheet;
    const doc = { styleSheets: [fake] } as unknown as Document;

    expect(collectStyleText(doc)).toBe("");
  });
});

describe("the document to rasterise", () => {
  const build = (background: string | null) =>
    buildExportSvg({
      content: prepareExportClone(world(), SHADOW),
      width: 100,
      height: 50,
      background,
      variables: { "--color-folder": "#c9a561" },
      css: ".parchment { color: red }",
    });

  it("puts the clone inside a foreignObject of the right size", () => {
    const svg = build("#ffffff");

    expect(svg).toContain(
      '<foreignObject x="0" y="0" width="100" height="50">',
    );
    expect(svg).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(svg).toContain("The Drowned Bell");
  });

  it("carries the stylesheet, and the reset that keeps tacks visible", () => {
    const svg = build("#ffffff");

    expect(svg).toContain(".parchment { color: red }");
    expect(svg).toContain("animation: none !important");
  });

  it("paints the background when there is one", () => {
    expect(build("#123456")).toContain(
      '<rect width="100" height="50" fill="#123456"/>',
    );
  });

  it("leaves the background out for a transparent export", () => {
    expect(build(null)).not.toContain("<rect");
  });

  it("puts the theme’s custom properties on the root, so colours resolve", () => {
    expect(build("#ffffff")).toContain("--color-folder: #c9a561;");
  });

  it("is well-formed XML, which is what an <img> will refuse it for", () => {
    // A whole browser round trip once failed here: Tailwind emits
    // `@property { syntax: "<color>" }`, and one unescaped `<` inside <style>
    // makes the document unparseable and the export a broken image.
    const svg = buildExportSvg({
      content: prepareExportClone(world(), SHADOW),
      width: 10,
      height: 10,
      background: null,
      variables: {},
      css: '@property --x { syntax: "<color>"; } a::after { content: "</style><script>" }',
    });
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");

    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(svg.match(/<\/style>/g)?.length).toBe(1);
    // Escaped in the document, and therefore intact for the CSS parser.
    expect(svg).toContain('syntax: "&lt;color>"');
  });
});
