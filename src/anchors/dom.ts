/**
 * The bridge between the flat-text model and a real rendered article.
 *
 * `projection.ts` defines what an offset means; this module is what makes those
 * offsets reachable from, and reachable *in*, actual DOM nodes. Two directions:
 *
 *   create  — a DOM Selection becomes a flat range (via `segmentsFor`)
 *   resolve — a flat range becomes a DOM Range, and then client rects for
 *             positioning the pin
 *
 * The subtle part is `segmentsFor`. Whitespace between block elements is not
 * reliable across renderers — pretty-printed HTML has a "\n" text node between
 * </p> and <p>, minified HTML has nothing — so we do not read it. Instead we
 * emit an explicit BLOCK_SEPARATOR between block-level elements, which makes the
 * flat text a function of the document's *structure* rather than of its
 * formatting. Without this, switching markdown renderers would shift every pin.
 */

import {
  BLOCK_SEPARATOR,
  buildFlatText,
  flatToRaw,
  rawToFlat,
  type FlatText,
  type FlatTextInput,
} from '../markdown/projection'

/**
 * Elements that start a new block of text. Between any two of these, a space
 * belongs in the flat text whether or not the HTML actually contains one.
 */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4',
  'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
  'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
])

/** One entry in the walk: a real text node, or a synthetic separator between two. */
export interface Segment {
  /** Null for synthetic separators, which have no DOM node behind them. */
  node: Text | null
  text: string
  preserveWhitespace: boolean
  /** Set on separators, so a caller can tell structure from content. */
  synthetic: boolean
}

/**
 * Walk a rendered article into ordered segments.
 *
 * A separator is emitted *before* each block after the first, which yields
 * separation between blocks without a trailing space on the document.
 */
export function segmentsFor(root: Node): Segment[] {
  const out: Segment[] = []

  const walk = (node: Node, inPre: boolean): void => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const text = node as Text
      if (text.data.length > 0) {
        out.push({ node: text, text: text.data, preserveWhitespace: inPre, synthetic: false })
      }
      return
    }

    if (node.nodeType !== 1 /* ELEMENT_NODE */) return
    const element = node as Element
    const tag = element.tagName.toUpperCase()

    // <br> is a hard line break with no text node of its own.
    if (tag === 'BR') {
      out.push({ node: null, text: BLOCK_SEPARATOR, preserveWhitespace: false, synthetic: true })
      return
    }

    if (BLOCK_TAGS.has(tag) && out.length > 0) {
      out.push({ node: null, text: BLOCK_SEPARATOR, preserveWhitespace: false, synthetic: true })
    }

    const childInPre = inPre || tag === 'PRE'
    for (const child of Array.from(element.childNodes)) walk(child, childInPre)
  }

  walk(root, false)
  return out
}

export interface DomProjection {
  flat: FlatText
  segments: Segment[]
  /** Text node -> its index in `segments`, for reverse lookups. */
  indexOf: Map<Text, number>
}

/** Build the flat text for a rendered article, plus the map back to its nodes. */
export function projectDom(root: Node): DomProjection {
  const segments = segmentsFor(root)

  const inputs: FlatTextInput[] = segments.map((segment) => ({
    text: segment.text,
    preserveWhitespace: segment.preserveWhitespace,
  }))

  const flat = buildFlatText(inputs)

  const indexOf = new Map<Text, number>()
  segments.forEach((segment, index) => {
    if (segment.node) indexOf.set(segment.node, index)
  })

  return { flat, segments, indexOf }
}

/**
 * Find the nearest segment at or before `index` that has a real text node.
 * Separators are structural, not addressable — a pin can't sit *on* one.
 */
function nearestRealSegment(segments: Segment[], index: number, step: 1 | -1): number {
  let i = index
  while (i >= 0 && i < segments.length) {
    if (segments[i].node) return i
    i += step
  }
  return -1
}

/**
 * A flat range -> a DOM Range. Returns null if either end is unaddressable
 * (an empty article, or offsets outside the text).
 *
 * A boundary landing on a separator is nudged to the nearest real text node in
 * the direction the range points, which keeps a pin spanning a paragraph break
 * anchored to actual words rather than to nothing.
 */
export function flatRangeToDomRange(
  projection: DomProjection,
  start: number,
  end: number,
): Range | null {
  const { flat, segments } = projection

  const rawStart = flatToRaw(flat, start)
  const rawEnd = flatToRaw(flat, end)
  if (!rawStart || !rawEnd) return null

  const startIndex = nearestRealSegment(segments, rawStart.nodeIndex, 1)
  const endIndex = nearestRealSegment(segments, rawEnd.nodeIndex, -1)
  if (startIndex === -1 || endIndex === -1) return null

  const startNode = segments[startIndex].node as Text
  const endNode = segments[endIndex].node as Text

  const doc = startNode.ownerDocument
  if (!doc) return null

  const range = doc.createRange()
  const clamp = (value: number, node: Text) => Math.max(0, Math.min(value, node.data.length))

  // If either boundary was nudged off a separator, the raw offset no longer
  // applies to that node — collapse it to the node's near edge instead.
  const startOffset =
    startIndex === rawStart.nodeIndex ? clamp(rawStart.rawOffset, startNode) : 0
  const endOffset =
    endIndex === rawEnd.nodeIndex ? clamp(rawEnd.rawOffset, endNode) : endNode.data.length

  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

/** A DOM Range -> a flat range. The inverse of `flatRangeToDomRange`. */
export function domRangeToFlatRange(
  projection: DomProjection,
  range: Range,
): { start: number; end: number } | null {
  const { flat, indexOf } = projection

  const startIndex = indexOf.get(range.startContainer as Text)
  const endIndex = indexOf.get(range.endContainer as Text)
  if (startIndex === undefined || endIndex === undefined) return null

  return {
    start: rawToFlat(flat, startIndex, range.startOffset),
    end: rawToFlat(flat, endIndex, range.endOffset),
  }
}

export interface AnchorRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Client rects for a DOM Range, expressed relative to the article's container.
 *
 * A range spanning a paragraph break yields one rect per line box, which is what
 * the caller needs to draw a highlight that follows the text rather than a
 * single box around everything in between.
 *
 * `scale` is the transform between client space and the container's own, and it
 * is required rather than defaulted because leaving it out is not a near miss —
 * it is the bug this parameter exists to fix. The container sits inside the
 * camera layer, so every client rect is the container-local one multiplied by
 * the zoom. Subtracting the container's origin converts the *offset* but not the
 * *size*: the result is still a delta in scaled pixels, and using it as a local
 * coordinate scales it a second time. Pins therefore sat down and to the right
 * of the words they were pinned to, by an amount that grew with the zoom — at
 * 131% a highlight was 1.31× too wide and drifted up to 140px off its word.
 * Nothing in the code looked wrong, and no test covered it, because jsdom has
 * no layout to be wrong about.
 *
 * `scale` is a plain number so this file stays free of any notion of a camera:
 * the caller owns the transform, this only applies it.
 *
 * Must be called after `document.fonts.ready` — measuring before webfonts load
 * places every pin using fallback metrics, which is the same class of bug: pins
 * subtly wrong, and nothing in the code looking incorrect.
 */
export function rangeToContainerRects(
  range: Range,
  container: Element,
  scale: number,
): AnchorRect[] {
  // Environments without layout (jsdom, some embedded webviews) have no
  // `getClientRects`. Returning nothing lets callers degrade to "pin with no
  // position" instead of throwing mid-render.
  if (typeof range.getClientRects !== 'function' || typeof container.getBoundingClientRect !== 'function') {
    return []
  }

  // A degenerate scale would put every rect at infinity; treating it as 1 at
  // least fails visibly rather than silently.
  const factor = scale > 0 ? 1 / scale : 1
  const origin = container.getBoundingClientRect()
  return Array.from(range.getClientRects()).map((rect) => ({
    x: (rect.left - origin.left) * factor,
    y: (rect.top - origin.top) * factor,
    width: rect.width * factor,
    height: rect.height * factor,
  }))
}

/** True once webfonts have loaded and text measurement is trustworthy. */
export async function fontsReady(doc: Document): Promise<void> {
  if (doc.fonts?.ready) await doc.fonts.ready
}
