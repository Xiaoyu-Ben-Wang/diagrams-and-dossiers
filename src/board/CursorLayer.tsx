/**
 * Where everyone else's pointer is.
 *
 * Rendered inside the transformed world, so a peer's position is just their board
 * coordinates — but counter-scaled by the zoom, because a cursor is a piece of UI
 * and not a thing on the cork. Without that it would grow to the size of a
 * post-it as you zoomed in.
 *
 * Cursors arrive about twenty times a second, which is not often enough to read
 * as movement, so each one eases toward wherever it was last reported. That easing
 * runs on its own frame loop and writes the transform itself rather than going
 * through React: a re-render twenty times a second would land the cursor back on
 * the raw reported position and undo the smoothing it had just done.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import type { BoardPresence, Peer } from "../realtime/presence";
import { PEER_EASE_MS, prefersReducedMotion } from "./motion";

export interface CursorLayerProps {
  /** Null when there is nobody to draw. */
  presence: BoardPresence | null;
  zoom: number;
}

/** Stable across renders, so `useSyncExternalStore` can compare it. */
const NO_PEERS: readonly Peer[] = [];

/** The arrow, drawn once. Its colour comes from the peer. */
const ARROW = "M2 1.6 L2 17.2 L6.3 13.1 L9 19.2 L11.9 17.9 L9.2 11.9 L15 11.5 Z";

/** A backgrounded tab returns with a huge gap; uncapped, the cursor flies across. */
const MAX_STEP_MS = 64;

function place(x: number, y: number, zoom: number): string {
  return `translate3d(${x}px, ${y}px, 0) scale(${1 / zoom})`;
}

export const CursorLayer = memo(function CursorLayer({
  presence,
  zoom,
}: CursorLayerProps) {
  // Subscribed here rather than in the screen: a cursor moves twenty times a
  // second, and a board that re-rendered with it would re-render everything on it.
  const subscribe = useCallback(
    (listener: () => void) => presence?.subscribe(listener) ?? (() => {}),
    [presence],
  );
  const peers = useSyncExternalStore(
    subscribe,
    useCallback(() => presence?.peers() ?? NO_PEERS, [presence]),
    useCallback(() => NO_PEERS, []),
  );

  const placed = peers.filter((peer) => peer.at !== null);

  const nodes = useRef(new Map<string, HTMLDivElement>());
  /** Where each cursor is being drawn, which trails where it was last reported. */
  const shown = useRef(new Map<string, { x: number; y: number }>());
  const targets = useRef(placed);
  const zoomRef = useRef(zoom);
  targets.current = placed;
  zoomRef.current = zoom;

  // Reduced motion is not a preference about decoration here: the easing *is* the
  // movement being asked against, so those cursors simply sit where they are.
  const easing = placed.length > 0 && !prefersReducedMotion();

  // Put each cursor where it belongs before the first paint, so it never flashes
  // at the origin. Only for cursors the loop is not already moving.
  useLayoutEffect(() => {
    for (const peer of placed) {
      const node = nodes.current.get(peer.userId);
      if (!node || !peer.at) continue;
      if (easing && shown.current.has(peer.userId)) continue;
      shown.current.set(peer.userId, peer.at);
      node.style.transform = place(peer.at.x, peer.at.y, zoomRef.current);
    }
  });

  // And let go of anyone who has left.
  useEffect(() => {
    for (const id of shown.current.keys()) {
      if (!targets.current.some((peer) => peer.userId === id)) {
        shown.current.delete(id);
      }
    }
  });

  useEffect(() => {
    if (!easing) return;

    let frame = 0;
    let last = performance.now();

    const step = (now: number): void => {
      const dt = Math.min(MAX_STEP_MS, now - last);
      last = now;
      // Frame-rate independent: the same easing at 60Hz and at 120Hz.
      const k = 1 - Math.exp(-dt / PEER_EASE_MS);

      for (const peer of targets.current) {
        if (!peer.at) continue;
        const node = nodes.current.get(peer.userId);
        if (!node) continue;

        const current = shown.current.get(peer.userId) ?? peer.at;
        const x = current.x + (peer.at.x - current.x) * k;
        const y = current.y + (peer.at.y - current.y) * k;
        shown.current.set(peer.userId, { x, y });
        node.style.transform = place(x, y, zoomRef.current);
      }

      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [easing]);

  if (placed.length === 0) return null;

  return (
    <div className="pointer-events-none" data-testid="cursor-layer">
      {placed.map((peer) => (
        <div
          key={peer.userId}
          ref={(node) => {
            if (node) nodes.current.set(peer.userId, node);
            else nodes.current.delete(peer.userId);
          }}
          data-testid={`cursor-${peer.userId}`}
          className="absolute left-0 top-0"
          style={{ willChange: easing ? "transform" : undefined }}
        >
          <svg
            width="16"
            height="20"
            viewBox="0 0 17 21"
            aria-hidden="true"
            style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.35))" }}
          >
            <path d={ARROW} fill={peer.color} stroke="white" strokeWidth="1" />
          </svg>
          <span
            className="ml-3 -mt-1 inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] leading-tight text-white"
            style={{ backgroundColor: peer.color }}
          >
            {peer.name}
          </span>
        </div>
      ))}
    </div>
  );
});
