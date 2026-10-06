export interface DecodedImage {
  src: string;
  width: number;
  height: number;
  name: string;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("the file could not be read as data"));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("the file could not be read"));
    reader.readAsDataURL(file);
  });
}

/** Needs a data URI or loaded URL: a `File` has no dimensions until decoded. */
function measure(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.onload = () =>
      resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
    probe.onerror = () => reject(new Error("the image could not be decoded"));
    probe.src = src;
  });
}

export function isImageFile(file: { type?: string; name?: string }): boolean {
  if (file.type?.startsWith("image/")) return true;
  // Files from some file managers arrive with no type, so fall back to the extension.
  return Boolean(
    file.name && /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name),
  );
}

export async function decodeImageFile(file: File): Promise<DecodedImage> {
  const src = await readAsDataUrl(file);
  const { width, height } = await measure(src);
  return { src, width, height, name: file.name };
}

export function firstImage(files: Iterable<File>): File | null {
  for (const file of files) if (isImageFile(file)) return file;
  return null;
}
