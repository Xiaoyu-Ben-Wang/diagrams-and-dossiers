/**
 * Making a board, which from this pass on means making it on the server.
 *
 * Answers `null` for every way that can fail — no session, no network, no
 * creator invite — and the caller then keeps the board on this machine instead.
 * A board you cannot make because the network is down is worse than one you
 * cannot share yet.
 */
import { ensureSession } from "../supabase/session";
import { createRemoteBoard } from "./remote";
import type { RemoteIdentity } from "./library";

/** `boards.slug` is unique across the whole table, so a bare name would collide. */
export function slugFor(name: string): string {
  const stem =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "board";
  const tail = Math.random().toString(36).slice(2, 8);
  return `${stem}-${tail}`;
}

export async function newBoardOnServer(
  name: string,
): Promise<RemoteIdentity | null> {
  const session = await ensureSession();
  if (!session) return null;

  const created = await createRemoteBoard(name, slugFor(name));
  if (!created) return null;

  return {
    id: created.id,
    editToken: created.editToken,
    viewToken: created.viewToken,
  };
}
