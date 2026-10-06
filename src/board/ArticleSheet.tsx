// The paper's transform must match `articleToBoard`, which reproduces it for measurement:
// change one without the other and a string ends somewhere its tack is not.

import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { ChevronDown, ChevronRight, RotateCw, X } from "lucide-react";

import type { ArticleEntity } from "../model/types";
import { DEFAULT_ARTICLE_OPTIONS } from "../model/article-options";
import { openAwayLinksInNewTab } from "../markdown/links";
import { linkifyMentions, markMissingMentions } from "../markdown/mentions";
import { FolderLabel } from "./FolderLabel";
import { Tack } from "./entities/Tack";
import { CLICK_SLOP, useBoardDrag } from "./useBoardDrag";
import { clampTilt, rotateAbout } from "./pivot";
import { foldedHeight, PAPER_MAX_WIDTH, PAPER_MIN_WIDTH } from "./tuning";
import { useResizeDrag } from "./useResizeDrag";
import { useRotateDrag } from "./useRotateDrag";
import type { ArticleNodes } from "./useArticleViews";
import type { Point } from "./yarn";
import { pinPoint, type PinView } from "./view";

export interface ArticleSheetProps {
  article: ArticleEntity;
  nodes: ArticleNodes;

  anchored: readonly PinView[];
  selected: boolean;
  selectedPins: ReadonlySet<string>;
  movingPin: string | null;
  zoom: number;
  pinAt: Point | null;

  mentionNames: ReadonlySet<string>;
  onClickArticle: (event: MouseEvent<HTMLDivElement>) => void;
  onStartYarn: (
    event: PointerEvent,
    fromId: string,
    origin: Point | null,
  ) => void;
  onMoveOne: (id: string, delta: Point) => void;
  onPinDrop: (id: string, clientX: number, clientY: number) => void;
  onOpenPinEditor: (id: string, clientX: number, clientY: number) => void;
  onPinHover: (pin: PinView, element: Element | null) => void;
  onRotate: (degrees: number) => void;
  onResize: (width: number) => void;
  onToggleCollapsed: () => void;
  onTapTab: () => void;
  onMove: (delta: Point) => void;
  toBoard: (clientX: number, clientY: number) => Point;
  articleToBoard: (articleId: string, local: Point) => Point | null;
}

const TACK_DX = -6;
const TACK_DY = -5;

export function ArticleSheet({
  article,
  nodes,
  anchored,
  selected,
  selectedPins,
  movingPin,
  zoom,
  pinAt,
  mentionNames,
  onClickArticle,
  onStartYarn,
  onMoveOne,
  onPinDrop,
  onOpenPinEditor,
  onPinHover,
  onRotate,
  onResize,
  onToggleCollapsed,
  onTapTab,
  onMove,
  toBoard,
  articleToBoard,
}: ArticleSheetProps) {
  const { board: pos, rotation: tilt, options } = article;
  const width = options.width;
  const collapsed = options.collapsed;

  // Linkify before React commits: the anchor projection measures the text that ends up on
  // the page, so replacing `@[Name]` after the fact would move every pin.
  const html = useMemo(
    () =>
      linkifyMentions(
        DOMPurify.sanitize(marked.parse(article.bodyMd, { async: false })),
      ),
    [article.bodyMd],
  );

  // Re-runs on `html` because React replaces the innerHTML wholesale, taking any classes
  // already applied with it.
  useEffect(() => {
    const element = nodes.article;
    if (!element) return;
    markMissingMentions(element, mentionNames);
    openAwayLinksInNewTab(element);
  }, [html, mentionNames, nodes]);

  const rotate = useRotateDrag({
    // The pin is the pivot, the one point that does not move when the sheet turns —
    // no tilt in this sum, deliberately.
    pivot: { x: pos.x + width / 2, y: pos.y },
    tilt,
    toBoard,
    onRotate,
    onReset: () => onRotate(0),
  });

  const resize = useResizeDrag({
    size: { width, height: 0 },
    toBoard,
    sizeAt: (pointer) => {
      const local = rotateAbout(
        { x: pos.x + width / 2, y: pos.y },
        pointer,
        -tilt,
      );
      const half = Math.abs(local.x - (pos.x + width / 2));
      return { width: clampWidth(half * 2), height: 0 };
    },
    onResize: (size) => onResize(size.width),
  });

  const tabDrag = useBoardDrag({ zoom, onDrag: onMove, onTap: onTapTab });

  // Remembered, not measured: when collapsed the element's height is the fold, so the
  // open height cannot be read back off it.
  const [openHeight, setOpenHeight] = useState(0);
  useEffect(() => {
    const element = nodes.paper;
    if (!element || collapsed) return;
    setOpenHeight(element.offsetHeight);
    // ResizeObserver is absent in jsdom.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      setOpenHeight(element.offsetHeight),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [nodes, collapsed]);

  const [dragging, setDragging] = useState(false);
  // Where a drag let go, so the browser's trailing click can be told from a real one.
  const suppressClickRef = useRef<{ x: number; y: number } | null>(null);

  const bodyDrag = useBoardDrag({
    zoom,
    // Not on the way down: capture retargets the click that follows onto the
    // sheet, and the click is how a link or a mention in the page is reached.
    captureOnPress: false,
    onDrag: onMove,
    onDragStart: () => {
      setDragging(true);
      window.getSelection()?.removeAllRanges();
    },
    onEnd: ({ clientX, clientY, travelled }) => {
      setDragging(false);
      if (travelled) suppressClickRef.current = { x: clientX, y: clientY };
    },
  });

  // A browser sends a click after every drag, at the drop point; matched by position so a
  // genuine click a moment later still gets through. Whoever asks first consumes it.
  const takeTrailingClick = (event: MouseEvent<HTMLDivElement>): boolean => {
    const swallowed = suppressClickRef.current;
    if (!swallowed) return false;
    suppressClickRef.current = null;
    const near =
      Math.abs(event.clientX - swallowed.x) <= CLICK_SLOP &&
      Math.abs(event.clientY - swallowed.y) <= CLICK_SLOP;
    if (!near) return false;
    event.stopPropagation();
    event.preventDefault();
    return true;
  };

  const foldRef = useRef<HTMLDivElement>(null);

  // Unfolding lives here, not on the fold: the drag hook's pointer capture retargets the
  // trailing click onto the sheet, so a handler on the fold never runs.
  const handleSheetClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (takeTrailingClick(event)) return;
    if (!collapsed) return;
    const target = event.target;
    if (
      target !== event.currentTarget &&
      !foldRef.current?.contains(target as Node)
    )
      return;
    onToggleCollapsed();
  };

  return (
    <div
      ref={(element) => {
        nodes.paper = element;
      }}
      data-testid="paper"
      data-board-entity="article"
      data-entity-id={article.id}
      data-article-id={article.id}
      data-dragging={dragging}
      data-collapsed={collapsed}
      {...bodyDrag}
      onClickCapture={takeTrailingClick}
      onClick={handleSheetClick}
      className={`parchment absolute top-0 left-0 rounded-sm rounded-tl-none shadow-xl ${
        collapsed ? "" : "px-9 py-8 sm:px-12 sm:py-10"
      } ${selected ? "ring-2 ring-brass/70" : ""}`}
      style={{
        width,
        height: collapsed ? foldedHeight(openHeight) : undefined,
        transformOrigin: "50% 0",
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0) rotate(${clampTilt(tilt)}deg)`,
      }}
    >
      <button
        type="button"
        data-testid="paper-pin"
        aria-label="Pin holding the page up; drag to tie a string"
        className="paper-pin tack absolute h-3.5 w-3.5 cursor-crosshair rounded-full"
        style={{
          left: "50%",
          top: 0,
          marginLeft: -7,
          marginTop: -7,
          touchAction: "none",
        }}
        onPointerDown={(event) => onStartYarn(event, article.id, pinAt)}
      />

      {selected ? (
        <>
          <span
            aria-hidden="true"
            className="image-rotate-stem absolute"
            style={{ left: "50%", top: "100%", height: 16, marginLeft: -1 }}
          />
          <button
            type="button"
            data-testid="article-rotate"
            aria-label="Drag to swing the page about its pin"
            className="image-rotate absolute"
            style={{ left: "50%", top: "100%", marginTop: 16, marginLeft: -11 }}
            {...rotate}
          >
            <RotateCw size={22} strokeWidth={2.2} aria-hidden="true" />
          </button>

          <button
            type="button"
            data-testid="article-resize"
            aria-label="Drag to change the page width"
            className="article-resize absolute top-1/2 -right-2 -translate-y-1/2"
            {...resize}
          >
            <svg
              viewBox="0 0 10 24"
              aria-hidden="true"
              className="h-full w-full"
            >
              <path
                d="M 3 4 V 20 M 7 4 V 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </>
      ) : null}

      <div
        className={`paper-tab-bar absolute -top-7 left-0 flex h-7 rounded-tl rounded-tr ${
          selected ? "bg-brass/80" : "bg-parchment-200/85"
        }`}
      >
        <button
          type="button"
          data-testid="paper-disclosure"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Open the page" : "Roll the page up"}
          title={collapsed ? "Open the page" : "Roll the page up"}
          // Stops the press reaching the tab's drag hook, where a release that never
          // travelled would read as a tap and open the editor.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onToggleCollapsed}
          data-selected={selected}
          className="paper-disclosure flex h-full w-8 items-center justify-center rounded-tl leading-none"
        >
          <span aria-hidden="true" className="paper-disclosure-glyph">
            {collapsed ? (
              <ChevronRight size={16} strokeWidth={2.25} />
            ) : (
              <ChevronDown size={16} strokeWidth={2.25} />
            )}
          </span>
        </button>

        <button
          type="button"
          data-testid="paper-tab"
          {...tabDrag}
          aria-pressed={selected}
          className={`paper-tab drag-bar h-full rounded-tr py-1 pr-3 pl-2 text-[12px] transition ${
            selected
              ? "bg-brass/80 text-cork-900"
              : "bg-parchment-200/85 text-ink-soft hover:bg-parchment-200"
          }`}
          title="Click to edit, drag to move"
        >
          {article.title?.trim() || "Untitled sheet"}
        </button>
      </div>

      {selected && !collapsed ? (
        <button
          type="button"
          data-testid="paper-close"
          aria-label="Roll the page up"
          className="sheet-close"
          style={{ right: -10, top: -10 }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onToggleCollapsed}
        >
          <X size={13} strokeWidth={2.5} aria-hidden="true" />
        </button>
      ) : null}

      {collapsed ? (
        <div
          ref={foldRef}
          data-testid="paper-fold"
          title="Unfold the page"
          aria-hidden="true"
          className="paper-fold"
        >
          {/* Inside the fold, not over it: a press that lands here must still read
              as a press on the folder, which is what unfolds it. */}
          <FolderLabel title={article.title?.trim() || "Untitled sheet"} />
        </div>
      ) : null}

      {collapsed ? null : (
        <div className="relative">
          <div
            ref={(element) => {
              nodes.article = element;
            }}
            onClick={onClickArticle}
            className="article relative cursor-text select-text"
            dangerouslySetInnerHTML={{ __html: html }}
          />

          <div className="pointer-events-none absolute inset-0">
            {anchored.map((pin) =>
              pin.rect ? (
                <div
                  key={`mark-${pin.id}`}
                  className="anchor-mark absolute transition-opacity duration-300"
                  data-status={pin.status}
                  style={{
                    left: pin.rect.x,
                    top: pin.rect.y,
                    width: pin.rect.width,
                    height: pin.rect.height,
                  }}
                />
              ) : null,
            )}

            {anchored.map((pin) =>
              pin.rect ? (
                <Tack
                  key={`tack-${pin.id}`}
                  pin={pin}
                  x={pin.rect.x + pin.rect.width + TACK_DX + pin.nudge.x}
                  y={pin.rect.y + TACK_DY + pin.nudge.y}
                  selected={selectedPins.has(pin.id)}
                  moving={movingPin === pin.id}
                  zoom={zoom}
                  onStartYarn={(event) =>
                    onStartYarn(event, pin.id, pinPoint(pin, articleToBoard))
                  }
                  onMove={onMoveOne}
                  onDrop={onPinDrop}
                  onOpenEditor={onOpenPinEditor}
                  onHover={onPinHover}
                />
              ) : null,
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ARTICLE_OPTIONS.width;
  return Math.max(
    PAPER_MIN_WIDTH,
    Math.min(PAPER_MAX_WIDTH, Math.round(value)),
  );
}
