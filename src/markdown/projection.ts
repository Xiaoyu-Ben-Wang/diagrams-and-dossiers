/**
 * The projection layer — the single source of truth for what an "offset" means.
 *
 * A pin anchors to a position in an article. It cannot anchor to a pixel offset
 * (those break the moment someone adds a sentence above) and it cannot anchor to
 * raw HTML offsets (those break when the renderer changes its output structure).
 * So it anchors to a position in the article's FLAT TEXT: the concatenation of
 * every text node, whitespace-normalized.
 *
 * Both sides of the system build that flat text with this module:
 *   - creating an anchor (DOM selection -> flat offsets), and
 *   - resolving an anchor (flat offsets -> DOM range).
 *
 * If those two ever disagreed about normalization, every anchor would silently
 * drift by a character or two. Hence: one implementation, used by both, with the
 * normalization behaviour pinned down by tests.
 *
 * The `map` returned alongside normalized text is what makes the round trip
 * possible. Normalizing collapses whitespace runs, so index N in the normalized
 * text is NOT index N in the raw text. `map` records the raw index for each
 * normalized index, which is what lets us get back to a real DOM offset.
 */

export interface NormalizedText {
  /** Whitespace-normalized text. */
  text: string
  /** The original, untouched text. */
  raw: string
  /** map[i] = index into `raw` for character i of `text`. */
  map: number[]
}

export interface FlatText {
  /** The concatenated, normalized text of every node. */
  text: string
  nodes: NormalizedText[]
  /** starts[i] = flat offset at which node i begins. */
  starts: number[]
}

/**
 * The separator the DOM walker emits between block-level elements (paragraphs,
 * list items, headings, table cells).
 *
 * This exists because whitespace between blocks is NOT reliable. Pretty-printed
 * HTML has a "\n" text node between </p> and <p>; minified HTML has nothing. If
 * the walker relied on those nodes, the same article would produce two different
 * flat texts depending on how the renderer formatted its output — and every pin
 * would shift when that changed. So the walker inserts this explicitly, and the
 * flat text becomes a function of the document's structure rather than of its
 * formatting.
 */
export const BLOCK_SEPARATOR = ' '

export interface NormalizeOptions {
  /**
   * Preserve whitespace exactly. Use inside <pre>/<code>, where indentation is
   * significant and collapsing it would corrupt both the text and the offsets.
   */
  preserveWhitespace?: boolean
}

const WHITESPACE = /\s/

/**
 * Normalize one text node, recording how to get back to raw indices.
 *
 * Every run of whitespace collapses to a single space. Runs are anchored at
 * their first character, so a collapsed space maps back to where the whitespace
 * actually started — which is what a Range needs to land in a sensible place.
 */
export function normalize(raw: string, options: NormalizeOptions = {}): NormalizedText {
  if (options.preserveWhitespace) {
    const map: number[] = new Array(raw.length)
    for (let i = 0; i < raw.length; i++) map[i] = i
    return { text: raw, raw, map }
  }

  const out: string[] = []
  const map: number[] = []

  let i = 0
  while (i < raw.length) {
    if (WHITESPACE.test(raw[i])) {
      const runStart = i
      while (i < raw.length && WHITESPACE.test(raw[i])) i++
      // Every run collapses to exactly one space, at any position. Leading and
      // trailing runs are kept, and both are load-bearing: in
      // "The <strong>tavern</strong> was quiet." the space lives at the END of
      // one text node and the START of another, so dropping either would glue
      // words together. Collapsing the seam between nodes is buildFlatText's
      // job, not this function's.
      out.push(' ')
      map.push(runStart)
    } else {
      out.push(raw[i])
      map.push(i)
      i++
    }
  }

  return { text: out.join(''), raw, map }
}

/**
 * Build the flat text for an ordered list of text nodes.
 *
 * The seam between two nodes is where naive implementations produce a double
 * space: a node ending "foo " followed by one starting " bar" would concatenate
 * to "foo  bar". Collapsing that here keeps quotes copied out of the flat text
 * matching cleanly against text copied out of the rendered page.
 */
export type FlatTextInput = string | { text: string; preserveWhitespace?: boolean }

export function buildFlatText(inputs: FlatTextInput[], options: NormalizeOptions = {}): FlatText {
  const nodes: NormalizedText[] = []
  const starts: number[] = []
  const parts: string[] = []
  let length = 0

  /** Remove a leading run of spaces, keeping `map` aligned with `text`. */
  const dropLeadingSpaces = (text: string, map: number[]): [string, number[]] => {
    let drop = 0
    while (drop < text.length && text[drop] === ' ') drop++
    return drop === 0 ? [text, map] : [text.slice(drop), map.slice(drop)]
  }

  /** Whether the text accumulated so far ends in a space. */
  let endsWithSpace = false

  for (let n = 0; n < inputs.length; n++) {
    const input = inputs[n]
    // A node may opt into whitespace preservation individually — text inside a
    // <pre> is significant even when its siblings' is not.
    const raw = typeof input === 'string' ? input : input.text
    const nodeOptions: NormalizeOptions =
      typeof input === 'string' || input.preserveWhitespace === undefined
        ? options
        : { ...options, preserveWhitespace: input.preserveWhitespace }

    const normalized = normalize(raw, nodeOptions)
    let text = normalized.text
    let map = normalized.map

    // Drop leading spaces when there's nothing before them, or when what's
    // before them already ends in a space. The first case keeps the document
    // from starting with a space (which would shift every offset by one); the
    // second collapses the seam, so a node ending "foo " followed by one
    // starting " bar" doesn't produce "foo  bar".
    //
    // Note this keys off the accumulated text, not the previous node: an
    // earlier node may have normalized away entirely (a whitespace-only text
    // node at the start of a pretty-printed article), leaving nothing to
    // inspect while the separator after it still needs collapsing.
    //
    // Whitespace-significant nodes are exempt: leading spaces inside a <pre>
    // are content, not an artifact of formatting.
    const preserve = nodeOptions.preserveWhitespace === true
    if (!preserve && (length === 0 || endsWithSpace)) {
      ;[text, map] = dropLeadingSpaces(text, map)
    }

    starts.push(length)
    nodes.push({ text, raw, map })
    parts.push(text)
    length += text.length
    endsWithSpace = text.endsWith(' ')
  }

  return { text: parts.join(''), nodes, starts }
}

/** Index of the node containing `offset`, or -1. Binary search over `starts`. */
export function nodeIndexAt(flat: FlatText, offset: number): number {
  const { starts, nodes } = flat
  let lo = 0
  let hi = starts.length - 1
  let found = -1

  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid] <= offset) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  if (found === -1) return -1
  // An offset sitting exactly at the end of the last node is valid (caret at
  // end of document); an offset beyond it is not.
  if (offset > starts[found] + nodes[found].text.length) return -1
  return found
}

/** Flat offset -> (node, offset within that node's normalized text). */
export function flatToNode(
  flat: FlatText,
  offset: number,
): { nodeIndex: number; offsetInNode: number } | null {
  const nodeIndex = nodeIndexAt(flat, offset)
  if (nodeIndex === -1) return null
  return { nodeIndex, offsetInNode: offset - flat.starts[nodeIndex] }
}

/** (node, offset within normalized text) -> flat offset. */
export function nodeToFlat(flat: FlatText, nodeIndex: number, offsetInNode: number): number {
  if (nodeIndex < 0 || nodeIndex >= flat.nodes.length) return -1
  const clamped = Math.max(0, Math.min(offsetInNode, flat.nodes[nodeIndex].text.length))
  return flat.starts[nodeIndex] + clamped
}

/**
 * Flat offset -> (node, offset into the node's RAW text).
 *
 * This is the conversion that actually reaches the DOM: Range and Selection
 * speak raw offsets, while everything in the anchor model speaks flat offsets.
 */
export function flatToRaw(
  flat: FlatText,
  offset: number,
): { nodeIndex: number; rawOffset: number } | null {
  const located = flatToNode(flat, offset)
  if (!located) return null
  const node = flat.nodes[located.nodeIndex]
  // A caret at the very end of a node maps to the end of the raw text, which
  // `map` cannot express (it has one entry per normalized character).
  if (located.offsetInNode >= node.text.length) {
    return { nodeIndex: located.nodeIndex, rawOffset: node.raw.length }
  }
  return { nodeIndex: located.nodeIndex, rawOffset: node.map[located.offsetInNode] }
}

/** Raw offset within a node -> flat offset. Used when creating an anchor. */
export function rawToFlat(flat: FlatText, nodeIndex: number, rawOffset: number): number {
  if (nodeIndex < 0 || nodeIndex >= flat.nodes.length) return -1
  const node = flat.nodes[nodeIndex]
  const target = Math.max(0, Math.min(rawOffset, node.raw.length))

  // `map` is non-decreasing, so a linear scan finds the first normalized
  // character at or after the raw offset. Nodes are small; this stays cheap.
  for (let i = 0; i < node.map.length; i++) {
    if (node.map[i] >= target) return flat.starts[nodeIndex] + i
  }
  return flat.starts[nodeIndex] + node.text.length
}

/** The flat text with a range normalized for display. Useful in error messages. */
export function sliceFlat(flat: FlatText, start: number, end: number): string {
  return flat.text.slice(Math.max(0, start), Math.max(0, end))
}
