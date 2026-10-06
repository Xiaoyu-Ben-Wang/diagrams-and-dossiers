import { isHttpImageSrc } from "../model/image-src";

/** Long enough for a slow host, short enough that the board does not sit waiting. */
export const MEASURE_TIMEOUT_MS = 8000;

/**
 * The natural size of a linked picture, so the board can give it a footprint.
 *
 * Rejects on `onerror` and on the timeout: a host that accepts the connection and
 * then sends nothing would otherwise leave this pending for the life of the tab.
 * jsdom fires neither event, so a test has to stub one of them.
 */
export function measure(
  src: string,
  timeoutMs: number = MEASURE_TIMEOUT_MS,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    let settled = false;

    const settle = (run: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run();
    };

    const timer = setTimeout(
      () => settle(() => reject(new Error("the picture did not load in time"))),
      timeoutMs,
    );

    probe.onload = () =>
      settle(() =>
        resolve({ width: probe.naturalWidth, height: probe.naturalHeight }),
      );
    probe.onerror = () =>
      settle(() => reject(new Error("the picture could not be loaded")));
    probe.src = src;
  });
}

/** The first link a drop or paste carries, if it carries one. */
export function linkFrom(data: DataTransfer | null): string | null {
  if (!data) return null;
  for (const type of ["text/uri-list", "text/plain"]) {
    for (const line of data.getData(type).split("\n")) {
      // A `uri-list` may carry comments and blank lines; either way the first
      // line that is a link is the one that was dragged.
      const text = line.trim();
      if (text && !text.startsWith("#") && isHttpImageSrc(text)) return text;
    }
  }
  return null;
}

/** A name for a linked picture, from the last segment of its path. */
export function nameFromUrl(src: string): string {
  try {
    const segments = new URL(src).pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    return last ? decodeURIComponent(last) : "Linked picture";
  } catch {
    return "Linked picture";
  }
}
