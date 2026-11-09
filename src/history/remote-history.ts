// Version history for a board on the server. The snapshots are taken there, by
// the hourly job in supabase/migrations/0012_board_snapshots.sql; this only reads.

import { rowToEntity, rowToString } from "../realtime/mapper";
import { getSupabase } from "../supabase/client";
import type { BoardHistory, SnapshotSummary } from "./types";

interface SummaryRow {
  id: string;
  taken_at: string;
  item_count: number;
  string_count: number;
}

export function remoteHistory(boardId: string): BoardHistory {
  return {
    async list() {
      try {
        const { data, error } = await getSupabase().rpc(
          "list_board_snapshots",
          { p_board: boardId },
        );
        if (error || !Array.isArray(data)) return null;
        return (data as SummaryRow[]).map((row): SnapshotSummary => ({
          id: row.id,
          takenAt: Date.parse(row.taken_at),
          items: row.item_count,
          strings: row.string_count,
        }));
      } catch {
        return null;
      }
    },

    async load(id) {
      try {
        const { data, error } = await getSupabase().rpc("get_board_snapshot", {
          p_snapshot: id,
        });
        if (error || !data) return null;
        const content = data as { items?: unknown[]; strings?: unknown[] };
        return {
          entities: (content.items ?? []).map(rowToEntity),
          strings: (content.strings ?? []).map(rowToString),
        };
      } catch (error) {
        console.warn("board: could not read a version", error);
        return null;
      }
    },
  };
}
