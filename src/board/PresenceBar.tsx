/**
 * Who is on the board, in the top bar.
 *
 * Named after the way a shared document shows its people: a row of faces, each in
 * the colour that person is drawn in everywhere else, and clicking one goes to
 * where they are. The colour is the link between this and the cursor on the cork —
 * it is the same value, worked out the same way from the same id, so the chip and
 * the pointer are recognisably the same person without anything being agreed.
 */
import { memo, useCallback, useSyncExternalStore } from "react";

import type { BoardPresence, Peer } from "../realtime/presence";
import type { Point } from "./yarn";

export interface PresenceBarProps {
  presence: BoardPresence | null;
  /** You, so the row is the room rather than only the other people in it. */
  self?: { name: string; color: string };
  /** Where to go when somebody is picked. Board coordinates. */
  onJump: (at: Point) => void;
}

const NOBODY: readonly Peer[] = [];

/** Google Docs' rule: one word gives two letters, more gives one from each of two. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** The face, wherever it is drawn: the top bar, or the corner of a locked thing. */
export function Avatar({
  name,
  color,
  title,
  className = "",
}: {
  name: string;
  color: string;
  title?: string;
  className?: string;
}) {
  return (
    <span
      className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-cork-900/70 ${className}`}
      style={{ backgroundColor: color }}
      title={title}
      aria-hidden={title === undefined}
    >
      {initials(name)}
    </span>
  );
}

function Chip({
  name,
  color,
  you,
  at,
  onJump,
}: {
  name: string;
  color: string;
  you?: boolean;
  at: Point | null;
  onJump: (at: Point) => void;
}) {
  // Nothing to go to until they have moved: presence says they are here, and the
  // cursor says where "here" is.
  if (you || at === null) {
    return (
      <span data-testid={you ? "presence-you" : undefined}>
        <Avatar
          name={name}
          color={color}
          className={at === null ? "opacity-45" : ""}
          title={you ? `${name} (you)` : `${name} — has not moved yet`}
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onJump(at)}
      className="rounded-full transition hover:scale-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
      title={`Go to ${name}`}
      aria-label={`Go to ${name}`}
      data-testid={`presence-${name}`}
    >
      <Avatar name={name} color={color} />
    </button>
  );
}

export const PresenceBar = memo(function PresenceBar({
  presence,
  self,
  onJump,
}: PresenceBarProps) {
  const subscribe = useCallback(
    (listener: () => void) => presence?.subscribe(listener) ?? (() => {}),
    [presence],
  );
  const peers = useSyncExternalStore(
    subscribe,
    useCallback(() => presence?.peers() ?? NOBODY, [presence]),
    useCallback(() => NOBODY, []),
  );

  if (!presence) return null;

  const here = peers.length + (self ? 1 : 0);

  return (
    <div
      className="ml-auto flex items-center gap-1"
      data-testid="presence-bar"
      aria-label={`${here} ${here === 1 ? "person" : "people"} on this board`}
    >
      {self ? (
        <Chip name={self.name} color={self.color} you at={null} onJump={onJump} />
      ) : null}
      {peers.map((peer) => (
        <Chip
          key={peer.userId}
          name={peer.name}
          color={peer.color}
          at={peer.at}
          onJump={onJump}
        />
      ))}
    </div>
  );
});
