/**
 * The single definition of an offset: flat text — every text node concatenated
 * and whitespace-normalized. Anchor creation and resolution both use it.
 */

export interface NormalizedText {
  text: string;
  raw: string;
  /** map[i] = index into `raw` for character i of `text`. */
  map: number[];
}

export interface FlatText {
  text: string;
  nodes: NormalizedText[];
  /** starts[i] = flat offset at which node i begins. */
  starts: number[];
}

/**
 * Whitespace between blocks is unreliable (pretty-printed HTML has a "\n" node,
 * minified none), so the walker emits this explicitly instead of reading it.
 */
export const BLOCK_SEPARATOR = " ";

export interface NormalizeOptions {
  /** Use inside <pre>/<code>: collapsing indentation there would corrupt offsets. */
  preserveWhitespace?: boolean;
}

const WHITESPACE = /\s/;

/**
 * Whitespace runs collapse to a single space mapped to the run's first
 * character, which is where a Range needs to land.
 */
export function normalize(
  raw: string,
  options: NormalizeOptions = {},
): NormalizedText {
  if (options.preserveWhitespace) {
    const map: number[] = new Array(raw.length);
    for (let i = 0; i < raw.length; i++) map[i] = i;
    return { text: raw, raw, map };
  }

  const out: string[] = [];
  const map: number[] = [];

  let i = 0;
  while (i < raw.length) {
    if (WHITESPACE.test(raw[i])) {
      const runStart = i;
      while (i < raw.length && WHITESPACE.test(raw[i])) i++;
      // Leading and trailing runs are load-bearing: the space around <strong>
      // lives at one node's end or another's start; buildFlatText joins the seam.
      out.push(" ");
      map.push(runStart);
    } else {
      out.push(raw[i]);
      map.push(i);
      i++;
    }
  }

  return { text: out.join(""), raw, map };
}

/** Joins nodes, collapsing the seam so "foo " + " bar" is not "foo  bar". */
export type FlatTextInput =
  string | { text: string; preserveWhitespace?: boolean };

export function buildFlatText(
  inputs: FlatTextInput[],
  options: NormalizeOptions = {},
): FlatText {
  const nodes: NormalizedText[] = [];
  const starts: number[] = [];
  const parts: string[] = [];
  let length = 0;

  const dropLeadingSpaces = (
    text: string,
    map: number[],
  ): [string, number[]] => {
    let drop = 0;
    while (drop < text.length && text[drop] === " ") drop++;
    return drop === 0 ? [text, map] : [text.slice(drop), map.slice(drop)];
  };

  let endsWithSpace = false;

  for (let n = 0; n < inputs.length; n++) {
    const input = inputs[n];
    const raw = typeof input === "string" ? input : input.text;
    const nodeOptions: NormalizeOptions =
      typeof input === "string" || input.preserveWhitespace === undefined
        ? options
        : { ...options, preserveWhitespace: input.preserveWhitespace };

    const normalized = normalize(raw, nodeOptions);
    let text = normalized.text;
    let map = normalized.map;

    // Drop leading spaces when nothing precedes them or the accumulated text
    // already ends in one; whitespace-significant nodes are exempt.
    const preserve = nodeOptions.preserveWhitespace === true;
    if (!preserve && (length === 0 || endsWithSpace)) {
      [text, map] = dropLeadingSpaces(text, map);
    }

    starts.push(length);
    nodes.push({ text, raw, map });
    parts.push(text);
    length += text.length;
    endsWithSpace = text.endsWith(" ");
  }

  return { text: parts.join(""), nodes, starts };
}

/** Index of the node containing `offset`, or -1. Binary search over `starts`. */
export function nodeIndexAt(flat: FlatText, offset: number): number {
  const { starts, nodes } = flat;
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (found === -1) return -1;
  // An offset exactly at the end of the last node is valid (caret at end of
  // document); one beyond it is not.
  if (offset > starts[found] + nodes[found].text.length) return -1;
  return found;
}

export function flatToNode(
  flat: FlatText,
  offset: number,
): { nodeIndex: number; offsetInNode: number } | null {
  const nodeIndex = nodeIndexAt(flat, offset);
  if (nodeIndex === -1) return null;
  return { nodeIndex, offsetInNode: offset - flat.starts[nodeIndex] };
}

export function nodeToFlat(
  flat: FlatText,
  nodeIndex: number,
  offsetInNode: number,
): number {
  if (nodeIndex < 0 || nodeIndex >= flat.nodes.length) return -1;
  const clamped = Math.max(
    0,
    Math.min(offsetInNode, flat.nodes[nodeIndex].text.length),
  );
  return flat.starts[nodeIndex] + clamped;
}

/** Flat offset -> (node, offset into the node's RAW text): Range speaks raw offsets. */
export function flatToRaw(
  flat: FlatText,
  offset: number,
): { nodeIndex: number; rawOffset: number } | null {
  const located = flatToNode(flat, offset);
  if (!located) return null;
  const node = flat.nodes[located.nodeIndex];
  // A caret at the very end of a node maps to the end of the raw text, which
  // `map` cannot express (it has one entry per normalized character).
  if (located.offsetInNode >= node.text.length) {
    return { nodeIndex: located.nodeIndex, rawOffset: node.raw.length };
  }
  return {
    nodeIndex: located.nodeIndex,
    rawOffset: node.map[located.offsetInNode],
  };
}

export function rawToFlat(
  flat: FlatText,
  nodeIndex: number,
  rawOffset: number,
): number {
  if (nodeIndex < 0 || nodeIndex >= flat.nodes.length) return -1;
  const node = flat.nodes[nodeIndex];
  const target = Math.max(0, Math.min(rawOffset, node.raw.length));

  // `map` is non-decreasing, so the first entry at or after the target is it.
  for (let i = 0; i < node.map.length; i++) {
    if (node.map[i] >= target) return flat.starts[nodeIndex] + i;
  }
  return flat.starts[nodeIndex] + node.text.length;
}

export function sliceFlat(flat: FlatText, start: number, end: number): string {
  return flat.text.slice(Math.max(0, start), Math.max(0, end));
}
