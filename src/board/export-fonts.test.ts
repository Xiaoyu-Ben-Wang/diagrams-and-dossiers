// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { fontsUsedIn, inlineExportFonts } from "./export-fonts";

// The decoded-face cache is module-level and keyed by url, which is the point of
// it in the app. Each test takes urls of its own so it reads its own fetch.
let nth = 0;
function freshCss(): string {
  nth += 1;
  return `
@font-face { font-family: 'Kalam'; src: url(/src/assets/fonts/v${nth}/kalam.woff2) format('woff2'); }
@font-face { font-family: 'Rock Salt'; src: url("/assets/v${nth}/rock-salt-D3fG4h.woff2") format('woff2'); }
@font-face { font-family: 'Courier Prime'; src: url(/assets/v${nth}/courier-prime-Ab12Cd.woff2) format('woff2'); }
.notice { color: red }
`;
}

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function fakeFetch(text = "FONTDATA") {
  return vi.fn(async () => new Response(bytes(text), { status: 200 }));
}

describe("fontsUsedIn", () => {
  it("collects the hands the board draws with, once each", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-note-font="kalam"></div>
      <div data-note-font="rock-salt"></div>
      <div data-note-font="kalam"></div>
    `;

    expect(fontsUsedIn(root).sort()).toEqual(["kalam", "rock-salt"]);
  });

  it("asks for no file for the system hand, which has none", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div data-note-font="system"></div>`;

    expect(fontsUsedIn(root)).toEqual([]);
  });

  it("asks for no file for a face this build no longer has", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div data-note-font="papyrus"></div>`;

    expect(fontsUsedIn(root)).toEqual([]);
  });
});

describe("inlineExportFonts", () => {
  it("puts the bytes of a used face into the stylesheet", async () => {
    const sheet = freshCss();
    const result = await inlineExportFonts(
      sheet,
      ["kalam"],
      fakeFetch("KALAMBYTES"),
    );

    expect(result).not.toContain("kalam.woff2");
    expect(result).toContain('url("data:font/woff2;base64,');
  });

  it("matches a face whose filename carries Vite’s hash", async () => {
    const sheet = freshCss();
    const result = await inlineExportFonts(sheet, ["rock-salt"], fakeFetch());

    expect(result).not.toContain("rock-salt-D3fG4h.woff2");
    expect(result).toContain("data:font/woff2;base64,");
  });

  it("leaves a face the board does not use as a url", async () => {
    const sheet = freshCss();
    const result = await inlineExportFonts(sheet, ["kalam"], fakeFetch());

    expect(result).toContain("rock-salt-D3fG4h.woff2");
    expect(result).toContain("courier-prime-Ab12Cd.woff2");
  });

  it("touches nothing when the board writes in the system hand alone", async () => {
    const sheet = freshCss();
    const fetcher = fakeFetch();
    const result = await inlineExportFonts(sheet, [], fetcher);

    expect(result).toBe(sheet);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the stylesheet when a face cannot be read", async () => {
    const sheet = freshCss();
    const failing = vi.fn(async () => new Response(null, { status: 404 }));
    const result = await inlineExportFonts(sheet, ["kalam"], failing);

    expect(result).toBe(sheet);
  });

  it("does not fetch the same face twice", async () => {
    const sheet = freshCss();
    const fetcher = fakeFetch();
    await inlineExportFonts(sheet, ["kalam"], fetcher);
    await inlineExportFonts(sheet, ["kalam"], fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
