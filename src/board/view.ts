import type { AnchorRect } from "../anchors/dom";
import type { Point } from "./yarn";

export interface PinView {
  id: string;
  quote: string;
  body: string;
  nudge: Point;
  /** 'free' is a pin stuck into the board rather than into text. */
  status: "exact" | "repaired" | "orphaned" | "free";
  detail: string;
  dateLabel: string;
  /** The article `rect` is measured in; null for a tack in the cork. */
  articleId: string | null;
  rect: AnchorRect | null;
  board: Point | null;
}

export interface DrawableString {
  id: string;
  slack: number;
  from: Point;
  to: Point;
}

/** Must match TACK_OFFSET_X/TACK_OFFSET_Y/TACK_RADIUS in kinds.ts. */
const TACK_OFFSET_X = -6;
const TACK_OFFSET_Y = -5;
const TACK_RADIUS = 7;

/** In the article's own space. */
export function tackPoint(rect: AnchorRect): Point {
  return {
    x: rect.x + rect.width + TACK_OFFSET_X + TACK_RADIUS,
    y: rect.y + TACK_OFFSET_Y + TACK_RADIUS,
  };
}

/** Board space, through the full article transform so the tack turns with the page; null for an orphan. */
export function pinPoint(
  pin: PinView,
  articleToBoard: (articleId: string, local: Point) => Point | null,
): Point | null {
  if (pin.rect && pin.articleId) {
    const tack = tackPoint(pin.rect);
    return articleToBoard(pin.articleId, {
      x: tack.x + pin.nudge.x,
      y: tack.y + pin.nudge.y,
    });
  }
  if (pin.board)
    return { x: pin.board.x + pin.nudge.x, y: pin.board.y + pin.nudge.y };
  return null;
}

/** `slack` must already be divided by the zoom, so it is a constant screen distance. */
export function withinSlop(
  point: Point,
  rect: AnchorRect,
  slack: number,
): boolean {
  return (
    point.x >= rect.x - slack &&
    point.x <= rect.x + rect.width + slack &&
    point.y >= rect.y - slack &&
    point.y <= rect.y + rect.height + slack
  );
}

/** One `closest` over all three selectors: the innermost carrier must win, or a middle-drag on a tack drags the page under it. */
export function entityIdFromElement(element: Element): string | null {
  const carrier = element.closest(
    "[data-entity-id], [data-pin-id], [data-post-it-id]",
  );
  if (!carrier) return null;
  return (
    carrier.getAttribute("data-entity-id") ??
    carrier.getAttribute("data-pin-id") ??
    carrier.getAttribute("data-post-it-id")
  );
}

export function articleIdFromRange(range: Range): string | null {
  const node = range.startContainer;
  const element =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : (node as ChildNode).parentElement;
  return (
    element?.closest("[data-article-id]")?.getAttribute("data-article-id") ??
    null
  );
}

/** jsdom reports computed lengths as empty strings, so a bare parseFloat would poison coordinates with NaN. */
export function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
