/**
 * Putting the note hands into the exported SVG as bytes.
 *
 * The export rasterises a `data:` URI, and an SVG loaded as an `<img>` fetches
 * nothing — so an `@font-face` pointing at `/assets/kalam-abc123.woff2` resolves
 * to nothing and every note exports in the fallback. The face has to be *in* the
 * document. Only the faces the clone actually uses are inlined, so a board of
 * system-font notes pays nothing.
 */

import { NOTE_FONTS, type NoteFont } from "../model/types";

/** `url(...)` inside an `@font-face`; the quote is optional and either kind. */
const FONT_URL = /url\((['"]?)([^'")]+\.woff2)\1\)/g;

/**
 * Which face a stylesheet url belongs to. Vite fingerprints assets
 * (`kalam-D3fG4h.woff2`) and serves them unfingerprinted in dev, so match the
 * stem exactly or with the hash still on it.
 */
function faceForUrl(url: string): NoteFont | null {
  const file = url.split(/[?#]/)[0].split("/").pop() ?? "";
  const stem = file.replace(/\.woff2$/i, "");
  for (const face of NOTE_FONTS) {
    if (face === "system") continue;
    if (stem === face || stem.startsWith(`${face}-`)) return face;
  }
  return null;
}

/**
 * The hands the clone draws with. `system` needs no file, and a face this build
 * does not have — an element left over from a board written when the set was
 * wider — has no file to fetch.
 */
export function fontsUsedIn(root: Element): NoteFont[] {
  const used = new Set<NoteFont>();
  for (const element of Array.from(root.querySelectorAll("[data-note-font]"))) {
    const face = element.getAttribute("data-note-font");
    if (
      face &&
      face !== "system" &&
      (NOTE_FONTS as readonly string[]).includes(face)
    ) {
      used.add(face as NoteFont);
    }
  }
  return [...used];
}

// Keyed by url, not by face: the dialog re-runs the whole pipeline on every
// background and scale change, and re-fetching and re-encoding a face each time
// is the one part of that which is pure waste.
const decoded = new Map<string, Promise<string | null>>();

function fontDataUri(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const cached = decoded.get(url);
  if (cached) return cached;

  const pending = (async () => {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      // Chunked: `String.fromCharCode(...bytes)` on a 60KB font blows the argument limit.
      for (let at = 0; at < bytes.length; at += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      }
      return `data:font/woff2;base64,${btoa(binary)}`;
    } catch {
      // Offline, or the asset moved. The export still renders, in the fallback face.
      return null;
    }
  })();

  decoded.set(url, pending);
  return pending;
}

/**
 * Returns the stylesheet with the used faces' urls replaced by their bytes.
 * Faces that cannot be read are left as they were, so a failure costs a face
 * rather than the whole export.
 */
export async function inlineExportFonts(
  css: string,
  faces: readonly NoteFont[],
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const wanted = new Set(faces);
  if (wanted.size === 0) return css;

  const urls = new Set<string>();
  for (const match of css.matchAll(FONT_URL)) {
    const face = faceForUrl(match[2]);
    if (face && wanted.has(face)) urls.add(match[2]);
  }
  if (urls.size === 0) return css;

  const inlined = new Map<string, string>();
  await Promise.all(
    [...urls].map(async (url) => {
      const data = await fontDataUri(url, fetchImpl);
      if (data) inlined.set(url, data);
    }),
  );
  if (inlined.size === 0) return css;

  return css.replace(FONT_URL, (whole, _quote, url: string) => {
    const data = inlined.get(url);
    return data ? `url("${data}")` : whole;
  });
}
