/**
 * Rasterising the board and handing it over as a file.
 *
 * Browser only: this is where the SVG becomes pixels. Verified by probe, not
 * by the unit suite — jsdom has no canvas. See `docs/export-image.md`.
 */

import { buildExportSvg, collectStyleText, prepareExportClone } from './export-image-dom'
import type { ExportPlan } from './export-image'

export interface RenderBoardPngOptions {
  world: HTMLElement
  plan: ExportPlan
  /** Null for an alpha PNG. */
  background: string | null
  /** The dot motif, or null for a plain background. */
  pattern?: string | null
  patternTile?: number
  /** Custom properties for the SVG root, so the clone's colours resolve. */
  variables: Record<string, string>
  /** The picture's unselected `filter`. See `prepareExportClone`. */
  imageShadow: string
  /** The stylesheet to inline. Defaults to the page's; a caller may pass text. */
  css?: string
  document?: Document
}

/**
 * Clipboard writes fail past a few megabytes — the limit is the platform's and
 * it is not reported before the attempt. Past this the dialog offers the
 * download instead of a Copy that cannot work.
 */
export const CLIPBOARD_MAX_BYTES = 8 * 1024 * 1024

export async function renderBoardPng(options: RenderBoardPngOptions): Promise<Blob> {
  const { world, plan, background, variables, imageShadow } = options
  const doc = options.document ?? document

  const clone = prepareExportClone(world, imageShadow)
  // Board point p lands at (p - bounds) * scale, which is the transform the
  // board itself uses, with the export's bounds as the camera.
  clone.style.transformOrigin = '0 0'
  clone.style.transform = `translate(${-plan.bounds.x * plan.scale}px, ${-plan.bounds.y * plan.scale}px) scale(${plan.scale})`

  const svg = buildExportSvg({
    content: clone,
    width: plan.width,
    height: plan.height,
    background,
    pattern: options.pattern ?? null,
    patternTile: options.patternTile,
    variables,
    css: options.css ?? collectStyleText(doc),
  })

  // A data URI, not a blob URL: Chrome taints the canvas for an SVG containing
  // a foreignObject when it is loaded through blob:, and refuses `toBlob`. The
  // same document through `data:` comes back clean. Measured, not guessed — see
  // the bisect in /tmp/yarn2/taint-bisect.js.
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()

  const canvas = doc.createElement('canvas')
  canvas.width = plan.width
  canvas.height = plan.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser will not give the export a canvas.')

  context.drawImage(image, 0, 0)
  return await canvasToBlob(canvas)
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      // A cross-origin picture leaves the canvas tainted, and this is where it
      // shows up rather than at drawImage.
      if (blob) resolve(blob)
      else reject(new Error('A picture on this board could not be included.'))
    }, 'image/png')
  })
}

/**
 * Save a blob. The object URL is revoked on the next turn of the loop rather
 * than immediately: revoking it in the same tick cancels the download in some
 * browsers before it has read the blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  // Firefox only honours the click on an anchor that is in the document;
  // Chrome and Safari fire it from a detached one.
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** False when the platform has no image clipboard, or the image is too big. */
export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  if (blob.size > CLIPBOARD_MAX_BYTES) return false
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false

  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}
