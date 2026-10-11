import simdWasmUrl from "@jsquash/webp/codec/enc/webp_enc_simd.wasm?url";
import plainWasmUrl from "@jsquash/webp/codec/enc/webp_enc.wasm?url";

/** Past this the stored copy is worth re-encoding rather than kept as it arrived. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** 4K UHD's long edge. A picture keeps its ratio inside it. */
export const MAX_UPLOAD_EDGE = 3840;

/** Tried in order; the first that lands under `MAX_UPLOAD_BYTES` wins. */
const QUALITY_LADDER = [0.82, 0.7, 0.6, 0.5, 0.4];

/** An animated GIF would come back as its first frame and an SVG rasterised, so
 *  neither is re-encoded. */
const RECODABLE_TYPE = /^image\/(?:png|jpe?g|webp|avif|bmp)$/i;
const RECODABLE_NAME = /\.(?:png|jpe?g|webp|avif|bmp)$/i;

export interface ShrunkImage {
  blob: Blob;
  width: number;
  height: number;
}

export function isRecodable(file: { type?: string; name?: string }): boolean {
  if (file.type) return RECODABLE_TYPE.test(file.type);
  return Boolean(file.name && RECODABLE_NAME.test(file.name));
}

/** `max` on the long edge, the other edge following the ratio. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function needsShrinking(
  width: number,
  height: number,
  bytes: number,
): boolean {
  return bytes > MAX_UPLOAD_BYTES || Math.max(width, height) > MAX_UPLOAD_EDGE;
}

/**
 * Walks the ladder down until the result fits. When none of them fit it returns
 * the last one: a picture still over budget is worth more to the board than no
 * picture. Noise is what reaches that floor — a photograph never does.
 */
export async function encodeWithinBudget(
  data: ImageData,
  encode: (data: ImageData, quality: number) => Promise<ArrayBuffer>,
): Promise<ArrayBuffer> {
  let encoded = await encode(data, QUALITY_LADDER[0]);
  for (const quality of QUALITY_LADDER.slice(1)) {
    if (encoded.byteLength <= MAX_UPLOAD_BYTES) return encoded;
    encoded = await encode(data, quality);
  }
  return encoded;
}

function drawToImageData(
  bitmap: ImageBitmap,
  size: { width: number; height: number },
): ImageData {
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("the canvas has no 2d context");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return context.getImageData(0, 0, size.width, size.height);
}

let encoder: Promise<
  (data: ImageData, options: { quality: number }) => Promise<ArrayBuffer>
> | null = null;

/**
 * Both wasm builds are emitted so a browser without SIMD still has one to load;
 * only the one `locateFile` names is ever fetched.
 */
function loadEncoder() {
  encoder ??= (async () => {
    const { init, default: encode } = await import("@jsquash/webp/encode");
    await init({
      locateFile: (path: string) =>
        path.includes("simd") ? simdWasmUrl : plainWasmUrl,
    });
    return encode;
  })();
  return encoder;
}

/**
 * Null whenever the picture should be stored exactly as it arrived: a format
 * that must not be re-encoded, one already inside both budgets, or one this
 * browser cannot decode. A failed shrink is never a failed upload.
 */
export async function shrinkImageFile(file: File): Promise<ShrunkImage | null> {
  if (!isRecodable(file)) return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  try {
    if (!needsShrinking(bitmap.width, bitmap.height, file.size)) return null;

    const size = fitWithin(bitmap.width, bitmap.height, MAX_UPLOAD_EDGE);
    const data = drawToImageData(bitmap, size);
    const encode = await loadEncoder();
    const bytes = await encodeWithinBudget(data, (pixels, quality) =>
      encode(pixels, { quality }),
    );

    return {
      blob: new Blob([bytes], { type: "image/webp" }),
      width: size.width,
      height: size.height,
    };
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}
