/**
 * Whitespace between blocks is unreliable across renderers, so segmentsFor emits
 * an explicit BLOCK_SEPARATOR instead of reading it.
 */

import {
  BLOCK_SEPARATOR,
  buildFlatText,
  flatToRaw,
  rawToFlat,
  type FlatText,
  type FlatTextInput,
} from "../markdown/projection";

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

export interface Segment {
  node: Text | null;
  text: string;
  preserveWhitespace: boolean;
  synthetic: boolean;
}

export function segmentsFor(root: Node): Segment[] {
  const out: Segment[] = [];

  const walk = (node: Node, inPre: boolean): void => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const text = node as Text;
      if (text.data.length > 0) {
        out.push({
          node: text,
          text: text.data,
          preserveWhitespace: inPre,
          synthetic: false,
        });
      }
      return;
    }

    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
    const element = node as Element;
    const tag = element.tagName.toUpperCase();

    // <br> is a hard line break with no text node of its own.
    if (tag === "BR") {
      out.push({
        node: null,
        text: BLOCK_SEPARATOR,
        preserveWhitespace: false,
        synthetic: true,
      });
      return;
    }

    if (BLOCK_TAGS.has(tag) && out.length > 0) {
      out.push({
        node: null,
        text: BLOCK_SEPARATOR,
        preserveWhitespace: false,
        synthetic: true,
      });
    }

    const childInPre = inPre || tag === "PRE";
    for (const child of Array.from(element.childNodes)) walk(child, childInPre);
  };

  walk(root, false);
  return out;
}

export interface DomProjection {
  flat: FlatText;
  segments: Segment[];
  indexOf: Map<Text, number>;
}

export function projectDom(root: Node): DomProjection {
  const segments = segmentsFor(root);

  const inputs: FlatTextInput[] = segments.map((segment) => ({
    text: segment.text,
    preserveWhitespace: segment.preserveWhitespace,
  }));

  const flat = buildFlatText(inputs);

  const indexOf = new Map<Text, number>();
  segments.forEach((segment, index) => {
    if (segment.node) indexOf.set(segment.node, index);
  });

  return { flat, segments, indexOf };
}

/** Separators are structural, not addressable — a pin can't sit on one. */
function nearestRealSegment(
  segments: Segment[],
  index: number,
  step: 1 | -1,
): number {
  let i = index;
  while (i >= 0 && i < segments.length) {
    if (segments[i].node) return i;
    i += step;
  }
  return -1;
}

/**
 * A flat range -> a DOM Range, or null if unaddressable. A boundary on a
 * separator is nudged to the nearest real text node in the range's direction.
 */
export function flatRangeToDomRange(
  projection: DomProjection,
  start: number,
  end: number,
): Range | null {
  const { flat, segments } = projection;

  const rawStart = flatToRaw(flat, start);
  const rawEnd = flatToRaw(flat, end);
  if (!rawStart || !rawEnd) return null;

  const startIndex = nearestRealSegment(segments, rawStart.nodeIndex, 1);
  const endIndex = nearestRealSegment(segments, rawEnd.nodeIndex, -1);
  if (startIndex === -1 || endIndex === -1) return null;

  const startNode = segments[startIndex].node as Text;
  const endNode = segments[endIndex].node as Text;

  const doc = startNode.ownerDocument;
  if (!doc) return null;

  const range = doc.createRange();
  const clamp = (value: number, node: Text) =>
    Math.max(0, Math.min(value, node.data.length));

  // A boundary nudged off a separator no longer has a valid offset in its node,
  // so collapse it to the node's near edge.
  const startOffset =
    startIndex === rawStart.nodeIndex
      ? clamp(rawStart.rawOffset, startNode)
      : 0;
  const endOffset =
    endIndex === rawEnd.nodeIndex
      ? clamp(rawEnd.rawOffset, endNode)
      : endNode.data.length;

  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

export function domRangeToFlatRange(
  projection: DomProjection,
  range: Range,
): { start: number; end: number } | null {
  const { flat, indexOf } = projection;

  const startIndex = indexOf.get(range.startContainer as Text);
  const endIndex = indexOf.get(range.endContainer as Text);
  if (startIndex === undefined || endIndex === undefined) return null;

  return {
    start: rawToFlat(flat, startIndex, range.startOffset),
    end: rawToFlat(flat, endIndex, range.endOffset),
  };
}

export interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Subtract the origin and divide by `scale` (the camera zoom), or pins drift off
 * their words by an amount that grows with zoom. Await `document.fonts.ready` first.
 */
export function rangeToContainerRects(
  range: Range,
  container: Element,
  scale: number,
): AnchorRect[] {
  // jsdom and some embedded webviews have no layout: no rects, so return [].
  if (
    typeof range.getClientRects !== "function" ||
    typeof container.getBoundingClientRect !== "function"
  ) {
    return [];
  }

  const factor = scale > 0 ? 1 / scale : 1;
  const origin = container.getBoundingClientRect();
  return Array.from(range.getClientRects()).map((rect) => ({
    x: (rect.left - origin.left) * factor,
    y: (rect.top - origin.top) * factor,
    width: rect.width * factor,
    height: rect.height * factor,
  }));
}

export async function fontsReady(doc: Document): Promise<void> {
  if (doc.fonts?.ready) await doc.fonts.ready;
}
