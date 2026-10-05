/**
 * Turning a file the user brought in into something that can be pinned up.
 *
 * Two steps that cannot be skipped: the bytes have to become a `src` the board
 * can draw, and the picture has to be measured before an entity can be made for
 * it — an image entity's whole footprint comes from its own proportions, so
 * there is nothing sensible to create until the file has been decoded.
 *
 * A data URI rather than `URL.createObjectURL`, deliberately. An object URL is
 * a handle into the document that made it: it dies with the page, and it means
 * nothing to anything the board is saved into or synced with. The picture has
 * to survive a reload to be worth pinning up, and a data URI is the only form
 * that does without a storage layer behind it.
 */

/** What a decoded picture yields. */
export interface DecodedImage {
  src: string
  width: number
  height: number
  /** The file's own name, used for the alt text so the picture is describable. */
  name: string
}

/** Read a file as a data URI. Rejects on anything the reader cannot finish. */
function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('the file could not be read as data'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('the file could not be read'))
    reader.readAsDataURL(file)
  })
}

/**
 * The natural pixel size of an image, once the browser has decoded it.
 *
 * Needs the source to be a data URI or an already-loaded URL: a `File` has no
 * dimensions until something has decoded it, which is the step this performs.
 */
function measure(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const probe = new Image()
    probe.onload = () =>
      resolve({ width: probe.naturalWidth, height: probe.naturalHeight })
    probe.onerror = () => reject(new Error('the image could not be decoded'))
    probe.src = src
  })
}

/** Whether a file is one the board knows how to put on the wall. */
export function isImageFile(file: { type?: string; name?: string }): boolean {
  if (file.type?.startsWith('image/')) return true
  // A file dragged from some file managers arrives with no type at all, so the
  // extension is the only thing left to go on.
  return Boolean(file.name && /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name))
}

/**
 * Decode a file into everything an image entity needs.
 *
 * Throws rather than returning null: every caller is already inside a gesture
 * the user completed, and there is nothing useful to do with a picture the
 * browser refused except say so.
 */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  const src = await readAsDataUrl(file)
  const { width, height } = await measure(src)
  return { src, width, height, name: file.name }
}

/**
 * The first image among a set of dropped or pasted files.
 *
 * A drop of several files is a normal thing to do and the board has one place
 * to put a picture, so the first image is taken and the rest ignored rather
 * than the whole gesture being refused.
 */
export function firstImage(files: Iterable<File>): File | null {
  for (const file of files) if (isImageFile(file)) return file
  return null
}
