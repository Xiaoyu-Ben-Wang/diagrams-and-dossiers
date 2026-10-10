/**
 * Reading a whole board: the first load, and the catch-up after a reconnect.
 *
 * Items come first, deliberately. A string names two of them, and the store holds
 * a string whose ends have not arrived yet rather than drawing it to the origin —
 * but there is no reason to make it do that when the order is ours to choose.
 */
import type { BoardState } from "../board/store";
import { getSupabase } from "../supabase/client";
import { rowToEntity, rowToString } from "./mapper";

/** Rows changed at or after this, for a catch-up. Epoch ms, exclusive. */
export interface CatchUp {
  since: number;
}

function sinceIso(since: number | undefined): string | null {
  return since === undefined || since <= 0
    ? null
    : new Date(since).toISOString();
}

export async function loadBoard(
  boardId: string,
  catchUp: CatchUp = { since: 0 },
): Promise<BoardState | null> {
  try {
    const supabase = getSupabase();
    const from = sinceIso(catchUp.since);

    let items = supabase.from("items").select("*").eq("board_id", boardId);
    let strings = supabase.from("strings").select("*").eq("board_id", boardId);
    if (from) {
      items = items.gte("updated_at", from);
      strings = strings.gte("updated_at", from);
    }

    const [itemRows, stringRows] = await Promise.all([items, strings]);
    if (itemRows.error || stringRows.error) {
      console.warn("board: could not read the board", itemRows.error ?? stringRows.error);
      return null;
    }

    return {
      entities: (itemRows.data ?? []).map(rowToEntity),
      strings: (stringRows.data ?? []).map(rowToString),
    };
  } catch (error) {
    console.warn("board: could not read the board", error);
    return null;
  }
}
