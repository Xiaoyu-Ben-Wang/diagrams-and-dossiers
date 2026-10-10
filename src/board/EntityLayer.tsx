import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import { TACK_RADIUS } from "../model/kinds";
import type { ImageEntity, NoteEntity } from "../model/types";
import { ImageCard } from "./ImageCard";
import { PostIt } from "./entities/PostIt";
import { Tack } from "./entities/Tack";
import type { Point } from "./yarn";
import type { BoardPresence, Peer } from "../realtime/presence";
import { PEER_EASE_MS, prefersReducedMotion } from "./motion";
import { EditingBadge } from "./EditingBadge";
import { pinPoint, type PinView } from "./view";

export interface EntityLayerProps {
  /**
   * Who else is here, for the things they are holding *right now* — which is not
   * where those things are. Kept out of the board deliberately: a position nobody
   * has let go of yet is not one to write down, and letting it into the store
   * would leave a phantom in every peer's own copy.
   *
   * Subscribed to here rather than in the screen, so a thing being dragged by
   * somebody else re-renders this layer and not the whole board.
   */
  presence: BoardPresence | null;
  freePins: readonly PinView[];
  images: readonly ImageEntity[];
  postIts: readonly NoteEntity[];

  selection: ReadonlySet<string>;
  movingPin: string | null;
  zoom: number;

  articleToBoard: (articleId: string, local: Point) => Point | null;
  toBoard: (clientX: number, clientY: number) => Point;
  anchorOf: (id: string) => Point | null;

  onStartYarn: (
    event: React.PointerEvent,
    fromId: string,
    origin: Point | null,
  ) => void;
  onMoveOne: (id: string, delta: Point) => void;
  onMoveEntity: (id: string, delta: Point) => void;
  onPinDrop: (id: string, clientX: number, clientY: number) => void;
  onOpenPinEditor: (id: string, clientX: number, clientY: number) => void;
  onPinHover: (pin: PinView, element: Element | null) => void;
  onRotate: (id: string, degrees: number) => void;
  onResize: (id: string, size: { width: number; height: number }) => void;
  onSelectImage: (id: string) => void;
  onSelectNote: (id: string) => void;
  onSetBody: (id: string, body: string) => void;
  onResizeNote: (id: string, size: { width: number; height: number }) => void;
  onSetFontScale: (id: string, scale: number) => void;
  onOpenStyleMenu: (id: string) => void;
  /** The note whose style menu is open, so its trigger can say so. */
  styleMenuNoteId: string | null;
  onRemove: (id: string) => void;
}

/** Stable across renders, so `useSyncExternalStore` can compare it. */
const NOTHING_MOVING: ReadonlyMap<string, Point> = new Map();
const NOTHING_EDITING: ReadonlyMap<string, Peer> = new Map();

/** A backgrounded tab returns with a huge gap; uncapped, the thing flies across. */
const MAX_STEP_MS = 64;

/**
 * The things other people are holding, eased the way their cursors are.
 *
 * Reports arrive every 50ms, and drawing them raw makes a dragged note step while
 * the pointer dragging it glides — two things in one person's hand, visibly apart.
 * Same constant as the cursors, so they arrive together.
 *
 * The whole offset is written straight to the element, and the entity is left
 * sitting at its own resting position while it happens. Both halves matter: a
 * state update is not a promise to commit before the next paint, so easing through
 * React lands in bursts, and letting React move the thing *as well* puts its commit
 * and this loop's write a frame out of step — which is a jump, which is the thing
 * being removed. It is written as `translate`, the standalone property, because a
 * picture carries its own `transform: rotate(...)` that this must not throw away.
 */
function useEasedMotion(
  presence: BoardPresence | null,
  resting: { current: ReadonlyMap<string, Point> },
): void {
  const reported = useSyncExternalStore(
    useCallback(
      (listener: () => void) => presence?.subscribe(listener) ?? (() => {}),
      [presence],
    ),
    useCallback(() => presence?.motion() ?? NOTHING_MOVING, [presence]),
    useCallback(() => NOTHING_MOVING, []),
  );

  const reportedRef = useRef(reported);
  reportedRef.current = reported;
  /**
   * How far each thing is drawn from where it is sitting, and which resting
   * position that offset was measured against.
   */
  const drawn = useRef(
    new Map<string, { offX: number; offY: number; restX: number; restY: number }>(),
  );
  /** The last reported position, kept past the letting go so it can settle onto it. */
  const lastTarget = useRef(new Map<string, Point>());
  const touching = useRef(new Set<string>());

  const easing = !prefersReducedMotion();

  useEffect(() => {
    let frame = 0;
    let last = performance.now();

    const step = (now: number): void => {
      const dt = Math.min(MAX_STEP_MS, now - last);
      last = now;
      const k = easing ? 1 - Math.exp(-dt / PEER_EASE_MS) : 1;

      for (const [id, at] of reportedRef.current) lastTarget.current.set(id, at);

      for (const [id, target] of lastTarget.current) {
        const node = nodeFor(id);
        const rest = resting.current.get(id);
        if (!node || !rest) {
          lastTarget.current.delete(id);
          drawn.current.delete(id);
          continue;
        }

        const seen = drawn.current.get(id);

        // The resting position moved, which means the write landed: the board owns
        // this position now, so the offset has done its job and is dropped.
        if (seen && (seen.restX !== rest.x || seen.restY !== rest.y)) {
          node.style.translate = "";
          lastTarget.current.delete(id);
          drawn.current.delete(id);
          continue;
        }

        // Eased as an offset *from where the thing is sitting*, starting at nothing.
        // Easing the position itself would have nothing to ease from on the first
        // frame and would snap the whole distance at once — the jump, reintroduced
        // by the code meant to remove it.
        const held = reportedRef.current.has(id);
        const goalX = held ? target.x - rest.x : (seen?.offX ?? 0);
        const goalY = held ? target.y - rest.y : (seen?.offY ?? 0);
        const offX = seen ? seen.offX + (goalX - seen.offX) * k : 0;
        const offY = seen ? seen.offY + (goalY - seen.offY) * k : 0;

        drawn.current.set(id, { offX, offY, restX: rest.x, restY: rest.y });
        node.style.translate = `${offX}px ${offY}px`;
        touching.current.add(id);
      }

      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      for (const id of touching.current) {
        const node = nodeFor(id);
        if (node) node.style.translate = "";
      }
      touching.current.clear();
    };
    // Deliberately not keyed on the reports: they arrive every 50ms, and re-running
    // this would tear the loop down and clear the correction between every pair of
    // them — which is the stepping it exists to remove. The loop reads the latest
    // through the ref instead.
  }, [easing, resting]);
}

/**
 * The outermost element carrying this thing's id. Some entities mark more than
 * one node, and the offset belongs on the one the board positions.
 */
function nodeFor(id: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const selector = `[data-entity-id="${id}"], [data-pin-id="${id}"], [data-post-it-id="${id}"]`;
  for (const found of document.querySelectorAll<HTMLElement>(selector)) {
    if (found.closest(selector) === found) return found;
  }
  return null;
}

export const EntityLayer = memo(function EntityLayer({
  presence,
  freePins,
  images,
  postIts,
  selection,
  movingPin,
  zoom,
  articleToBoard,
  toBoard,
  anchorOf,
  onStartYarn,
  onMoveOne,
  onMoveEntity,
  onPinDrop,
  onOpenPinEditor,
  onPinHover,
  onRotate,
  onResize,
  onSelectImage,
  onSelectNote,
  onSetBody,
  onResizeNote,
  onSetFontScale,
  onOpenStyleMenu,
  styleMenuNoteId,
  onRemove,
}: EntityLayerProps) {
  // Where each thing sits when nobody is holding it. The easing is drawn as an
  // offset from this, so nothing here has to move while somebody drags it.
  const resting = useRef<ReadonlyMap<string, Point>>(new Map());
  resting.current = useMemo(() => {
    const map = new Map<string, Point>();
    for (const pin of freePins) if (pin.board) map.set(pin.id, pin.board);
    for (const picture of images) map.set(picture.id, picture.board);
    for (const note of postIts) map.set(note.id, note.board);
    return map;
  }, [freePins, images, postIts]);

  useEasedMotion(presence, resting);

  // Who is holding what. Kept out of the board for the same reason a drag is: it
  // is not part of the document, and a lock is only true while the person is here.
  const editingBy = useSyncExternalStore(
    useCallback(
      (listener: () => void) => presence?.subscribe(listener) ?? (() => {}),
      [presence],
    ),
    useCallback(() => presence?.editors() ?? NOTHING_EDITING, [presence]),
    useCallback(() => NOTHING_EDITING, []),
  );

  /** The top-right corner of a thing, where its badge hangs. */
  const cornerOf = useCallback(
    (id: string): Point | null => {
      const pin = freePins.find((each) => each.id === id);
      if (pin?.board) return { x: pin.board.x, y: pin.board.y - TACK_RADIUS };
      const picture = images.find((each) => each.id === id);
      if (picture) {
        return { x: picture.board.x + picture.width, y: picture.board.y };
      }
      const note = postIts.find((each) => each.id === id);
      if (note) return { x: note.board.x + note.width, y: note.board.y };
      // A pin on a page, or the page itself: wherever its anchor lands.
      return anchorOf(id);
    },
    [freePins, images, postIts, anchorOf],
  );

  const startPinYarn = useCallback(
    (event: React.PointerEvent, pin: PinView) =>
      onStartYarn(event, pin.id, pinPoint(pin, articleToBoard)),
    [onStartYarn, articleToBoard],
  );
  const startImageYarn = useCallback(
    (event: React.PointerEvent, id: string) =>
      onStartYarn(event, id, anchorOf(id)),
    [onStartYarn, anchorOf],
  );

  return (
    <>
      {freePins.map((pin) =>
        pin.board ? (
          <Tack
            key={`free-${pin.id}`}
            pin={pin}
            x={pin.board.x - TACK_RADIUS + pin.nudge.x}
            y={pin.board.y - TACK_RADIUS + pin.nudge.y}
            selected={selection.has(pin.id)}
            moving={movingPin === pin.id}
            zoom={zoom}
            onStartYarn={startPinYarn}
            onMove={onMoveOne}
            onDrop={onPinDrop}
            onOpenEditor={onOpenPinEditor}
            onHover={onPinHover}
          />
        ) : null,
      )}

      {images.map((picture) => (
        <ImageCard
          key={picture.id}
          id={picture.id}
          src={picture.src}
          alt={picture.alt}
          x={picture.board.x}
          y={picture.board.y}
          width={picture.width}
          height={picture.height}
          rotation={picture.rotation}
          fit={picture.fit}
          edge={picture.edge}
          edgeSeed={picture.edgeSeed}
          frame={picture.frame ?? "none"}
          title={picture.title ?? ""}
          description={picture.bodyMd}
          selected={selection.has(picture.id)}
          zoom={zoom}
          toBoard={toBoard}
          onMove={onMoveEntity}
          onRotate={onRotate}
          onSelect={onSelectImage}
          onResize={onResize}
          onStartYarn={startImageYarn}
        />
      ))}

      {[...editingBy].map(([id, peer]) => {
        const corner = cornerOf(id);
        return corner ? (
          <EditingBadge
            key={`editing-${id}`}
            peer={peer}
            x={corner.x}
            y={corner.y}
            zoom={zoom}
          />
        ) : null;
      })}

      {postIts.map((note) => (
        <PostIt
          key={note.id}
          note={note}
          zoom={zoom}
          selected={selection.has(note.id)}
          toBoard={toBoard}
          onSelect={onSelectNote}
          onDrag={onMoveEntity}
          onChange={onSetBody}
          onResize={onResizeNote}
          onSetFontScale={onSetFontScale}
          onOpenStyleMenu={onOpenStyleMenu}
          styleMenuOpen={styleMenuNoteId === note.id}
          onRemove={onRemove}
          locked={editingBy.has(note.id)}
        />
      ))}
    </>
  );
});
