/**
 * Whose hands a thing is in.
 *
 * Drawn as a sibling of the entity rather than inside it, so nothing about how a
 * note or a picture draws itself has to change to be lockable. Counter-scaled by
 * the zoom like the cursors, because this is a piece of UI and not something on
 * the cork.
 */
import { memo } from "react";

import type { Peer } from "../realtime/presence";
import { Avatar } from "./PresenceBar";

export interface EditingBadgeProps {
  peer: Peer;
  /** Board coordinates of the corner it hangs off. */
  x: number;
  y: number;
  zoom: number;
}

export const EditingBadge = memo(function EditingBadge({
  peer,
  x,
  y,
  zoom,
}: EditingBadgeProps) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: x,
        top: y,
        transform: `scale(${1 / zoom})`,
        transformOrigin: "0 100%",
      }}
      data-testid={`editing-${peer.editing}`}
    >
      <Avatar
        name={peer.name}
        color={peer.color}
        title={`${peer.name} is editing this`}
      />
    </div>
  );
});
