/** Long enough for a signed CDN URL; short enough that a src cannot be a payload. */
export const MAX_IMAGE_URL = 4096;

/** A link the board can add as a picture, as opposed to a file it took a copy of. */
export function isHttpImageSrc(src: string): boolean {
  return /^https?:\/\//i.test(src) && src.length <= MAX_IMAGE_URL;
}
