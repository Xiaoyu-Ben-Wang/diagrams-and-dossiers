/**
 * Turning the live world layer into something an `<img>` can rasterise: a
 * clone, with the chrome taken out and the stylesheet inlined.
 *
 * No rasterising here, so all of it runs under jsdom. See `export-png.ts` for
 * the part that needs a real browser, and `docs/export-image.md` for why the
 * pipeline is a `foreignObject` rather than a canvas painter.
 */

/**
 * Chrome drawn *inside* the world layer, which a clone would otherwise carry.
 * Everything else — the palette, the zoom readout, the tooltip, the context
 * menu — is outside the world and never cloned.
 */
export const EXPORT_HIDE_SELECTORS = [
  '.post-it-tools',
  '.post-it-resize',
  '.post-it-close',
  '.image-resize',
  '.image-rotate',
  '.image-rotate-stem',
  '.article-resize',
  '.sheet-close',
  '.paper-close',
  '.yarn-bead',
  '[data-testid="yarn-halo"]',
  '[data-testid="live-yarn"]',
] as const

/** Classes that mean "selected", stripped so no export carries a selection. */
export const EXPORT_SELECTION_CLASSES = ['is-selected', 'ring-2', 'ring-brass/70'] as const

/**
 * Appended after the inlined stylesheet.
 *
 * The animation reset is load-bearing rather than tidy: `.tack-enter` starts at
 * `opacity: 0` with `animation-fill-mode: both`, and an SVG loaded as an image
 * is a static document, so without this every tack can export invisible.
 */
export const EXPORT_RESET_CSS = `
${EXPORT_HIDE_SELECTORS.join(',\n')} { display: none !important; }
*, *::before, *::after { animation: none !important; transition: none !important; }
`

/**
 * A copy of the world layer, ready to draw: chrome gone, selection gone, form
 * values written in.
 *
 * `imageShadow` is the picture's unselected `filter`, passed in rather than
 * imported because it is the only way to take a selection rim off: the rim is
 * an inline style on the shadow element, so stripping the class that names it
 * does nothing.
 */
export function prepareExportClone(world: HTMLElement, imageShadow: string): HTMLElement {
  const clone = world.cloneNode(true) as HTMLElement

  for (const selector of EXPORT_HIDE_SELECTORS) {
    for (const node of Array.from(clone.querySelectorAll(selector))) node.remove()
  }

  for (const node of Array.from(clone.querySelectorAll('*'))) {
    for (const name of EXPORT_SELECTION_CLASSES) node.classList.remove(name)
    node.removeAttribute('data-selected')
    node.removeAttribute('data-dragging')
  }
  for (const name of EXPORT_SELECTION_CLASSES) clone.classList.remove(name)
  clone.removeAttribute('data-dragging')

  restoreFormValues(world, clone)
  restoreImageShadows(clone, imageShadow)
  dropEmptyStringNotes(clone)

  // The world's own transform is the camera. The caller sets the export's.
  clone.style.transform = ''
  clone.style.willChange = 'auto'

  return clone
}

/**
 * React sets a textarea's value as a property, not an attribute, so a clone
 * serialises the writing as an empty box.
 */
function restoreFormValues(source: HTMLElement, clone: HTMLElement): void {
  const originals = source.querySelectorAll('input, textarea')
  const copies = clone.querySelectorAll('input, textarea')
  copies.forEach((copy, index) => {
    const original = originals[index]
    if (!(original instanceof HTMLInputElement || original instanceof HTMLTextAreaElement)) return
    if (copy instanceof HTMLInputElement || copy instanceof HTMLTextAreaElement) {
      copy.setAttribute('value', original.value)
      copy.textContent = original.value
    }
  })
}

function restoreImageShadows(clone: HTMLElement, imageShadow: string): void {
  for (const copy of Array.from(clone.querySelectorAll<HTMLElement>('.image-shadow'))) {
    copy.style.filter = imageShadow
  }
}

/**
 * A string note showing nothing but its "+ note" prompt is an invitation to
 * edit, which an export cannot answer.
 */
function dropEmptyStringNotes(clone: HTMLElement): void {
  for (const note of Array.from(clone.querySelectorAll('.string-note'))) {
    if (note.querySelector('.string-note-prompt') && !note.querySelector('textarea')) {
      note.remove()
    }
  }
}

/** Every stylesheet the page has, as CSS text. */
export function collectStyleText(doc: Document = document): string {
  const parts: string[] = []
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      // Cross-origin, and therefore not ours to inline.
      continue
    }
    for (const rule of Array.from(rules)) parts.push(rule.cssText)
  }
  return parts.join('\n')
}

export interface ExportSvgInput {
  content: HTMLElement
  width: number
  height: number
  /** Null leaves the SVG without a background, so the PNG keeps its alpha. */
  background: string | null
  /** A CSS background-image for the board's dot motif, or null to leave it plain. */
  pattern?: string | null
  /** Board px between dots. */
  patternTile?: number
  /** Custom properties to put on the root, so the clone's colours resolve. */
  variables: Record<string, string>
  css: string
}

/**
 * The document to rasterise: the clone inside a `foreignObject`, with the whole
 * stylesheet inlined.
 *
 * The stylesheet goes in whole rather than as per-element computed styles —
 * cheaper on a board of two hundred notes, and it keeps the rules a computed
 * style cannot express, like `::before` and `nth-child`.
 */
export function buildExportSvg(input: ExportSvgInput): string {
  const { content, width, height, background, pattern, variables, css } = input
  const tile = input.patternTile ?? 24

  // On the wrapper rather than as an SVG pattern: it is one CSS declaration,
  // and it tiles in the export's own coordinates so the same board always
  // exports the same dots.
  const wrapperStyle = [
    `width: ${width}px`,
    `height: ${height}px`,
    pattern ? `background-image: ${pattern}` : '',
    pattern ? `background-size: ${tile}px ${tile}px` : '',
  ]
    .filter(Boolean)
    .join('; ')

  const rootStyle = Object.entries(variables)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ')

  const backgroundRect = background
    ? `<rect width="${width}" height="${height}" fill="${escapeAttribute(background)}"/>`
    : ''

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`,
    ` viewBox="0 0 ${width} ${height}" style="${escapeAttribute(rootStyle)}">`,
    `<style>${escapeCss(css)}${EXPORT_RESET_CSS}</style>`,
    backgroundRect,
    `<foreignObject x="0" y="0" width="${width}" height="${height}">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${escapeAttribute(wrapperStyle)}">`,
    new XMLSerializer().serializeToString(content),
    '</div>',
    '</foreignObject>',
    '</svg>',
  ].join('')
}

/** Keep a colour or a font stack from closing the tag it is written in. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * The stylesheet goes into an XML document, so its text has to be escaped for
 * XML: an unescaped `<` makes the whole SVG malformed and the browser refuses
 * to decode it. Tailwind v4 emits real ones — `@property { syntax: "<color>" }`
 * — so this is not hypothetical. Entities are resolved before the CSS parser
 * sees the element, so the stylesheet arrives intact.
 */
function escapeCss(css: string): string {
  return css.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}
