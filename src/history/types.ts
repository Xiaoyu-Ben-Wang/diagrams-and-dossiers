import type { BoardState } from "../board/store";

/** One saved version of a board, without its content. */
export interface SnapshotSummary {
  id: string;
  /** Epoch ms. */
  takenAt: number;
  items: number;
  strings: number;
}

/** Where a board's earlier versions come from: the server for a shared board, this browser for a local one. */
export interface BoardHistory {
  /** Newest first. Null when the list could not be read. */
  list(): Promise<SnapshotSummary[] | null>;
  load(id: string): Promise<BoardState | null>;
}
