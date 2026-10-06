// Where boards live. The interface is worth its few lines because the in-memory
// adapter is not test scaffolding: IndexedDB is unavailable in private windows,
// in some managed browsers, and in jsdom, and the app has to work anyway.

import { indexedDbBoardStorage } from "./indexeddb-storage";
import type { BoardRecord } from "./board-record";

export interface BoardStorage {
  /** Most recently changed first. */
  list(): Promise<BoardRecord[]>;
  get(id: string): Promise<BoardRecord | null>;
  put(record: BoardRecord): Promise<void>;
  remove(id: string): Promise<void>;
  /** True when writes are not reaching somewhere durable. */
  degraded?(): boolean;
  /** Records already in hand, so a caller can be ready on the very first render. */
  snapshot?(): BoardRecord[];
}

export function byUpdatedDesc(a: BoardRecord, b: BoardRecord): number {
  return b.updatedAt - a.updatedAt;
}

export function memoryBoardStorage(
  initial: readonly BoardRecord[] = [],
  options: { degraded?: boolean } = {},
): BoardStorage {
  const records = new Map<string, BoardRecord>();
  for (const record of initial) records.set(record.id, record);

  const sorted = (): BoardRecord[] => [...records.values()].sort(byUpdatedDesc);

  return {
    async list() {
      return sorted();
    },
    async get(id) {
      return records.get(id) ?? null;
    },
    async put(record) {
      records.set(record.id, record);
    },
    async remove(id) {
      records.delete(id);
    },
    degraded: () => options.degraded === true,
    snapshot: sorted,
  };
}

let storage: BoardStorage | null = null;

/** Created on first use, not at import: tests swap `indexedDB` before this runs. */
export function getBoardStorage(): BoardStorage {
  if (!storage) storage = indexedDbBoardStorage();
  return storage;
}

export function setBoardStorageForTests(next: BoardStorage | null): void {
  storage = next;
}
