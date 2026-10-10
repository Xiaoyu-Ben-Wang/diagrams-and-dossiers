/**
 * The three RPCs that make a board real: minting one, being let in by a creator
 * invite, and walking in through a board link.
 *
 * All three are `security definer` functions in the migration, and all three
 * answer `null` on any failure rather than throwing. The caller has a board to
 * show either way — the question is only whether it is a shared one.
 */
import type { Role } from "../model/types";
import { getSupabase } from "../supabase/client";

export interface CreatedBoard {
  id: string;
  viewToken: string;
  editToken: string;
  dmToken: string;
}

function failed(what: string, error: unknown): void {
  console.warn(`board: ${what} failed`, error);
}

function failure(what: string, error: unknown): null {
  failed(what, error);
  return null;
}

/** Needs `profiles.can_create_boards`, which only a redeemed invite grants. */
export async function createRemoteBoard(
  name: string,
  slug: string,
): Promise<CreatedBoard | null> {
  try {
    const { data, error } = await getSupabase().rpc("create_board", {
      p_name: name,
      p_slug: slug,
    });
    if (error) return failure("creating a board", error);

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.board_id) return failure("creating a board", "no board came back");

    return {
      id: row.board_id as string,
      viewToken: row.view_token as string,
      editToken: row.edit_token as string,
      dmToken: row.dm_token as string,
    };
  } catch (error) {
    return failure("creating a board", error);
  }
}

/** The one thing that grants the right to make boards of your own. */
export async function redeemCreatorInvite(
  token: string,
  displayName: string,
): Promise<boolean> {
  try {
    const { error } = await getSupabase().rpc("redeem_creator_invite", {
      p_token: token,
      p_display_name: displayName,
    });
    if (error) {
      failure("redeeming an invite", error);
      return false;
    }
    return true;
  } catch (error) {
    failure("redeeming an invite", error);
    return false;
  }
}

export interface Joined {
  boardId: string;
  role: Role;
}

/** `join_board` hands back a role, not a name, so the library asks for one. */
export async function boardName(boardId: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabase()
      .from("boards")
      .select("name")
      .eq("id", boardId)
      .maybeSingle();
    if (error || !data) return null;
    return typeof data.name === "string" ? data.name : null;
  } catch (error) {
    return failure("reading a board's name", error);
  }
}

/**
 * The token decides the role, and the server records it as a `members` row — the
 * token never appears in a request again after this one.
 */
export async function joinBoard(
  token: string,
  displayName: string | null,
): Promise<Joined | null> {
  try {
    const { data, error } = await getSupabase().rpc("join_board", {
      p_token: token,
      p_display_name: displayName,
    });
    if (error) return failure("joining a board", error);

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.board_id) return failure("joining a board", "no board came back");

    return { boardId: row.board_id as string, role: row.role as Role };
  } catch (error) {
    return failure("joining a board", error);
  }
}

/**
 * Deletes a board and everything on it, for everyone. Allowed by RLS only for the
 * owner, so this is only ever called for a board this browser made — one that
 * holds its own edit token.
 *
 * A delete that RLS refuses comes back as success with no rows, exactly like one
 * that worked, so `false` here means the request failed rather than that it was
 * turned down. The caller is the owner or it would not have asked.
 */
export async function deleteRemoteBoard(id: string): Promise<boolean> {
  try {
    const { error } = await getSupabase().from("boards").delete().eq("id", id);
    if (error) {
      failed("deleting a board", error);
      return false;
    }
    return true;
  } catch (error) {
    failed("deleting a board", error);
    return false;
  }
}
