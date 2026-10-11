// The list of boards, over whichever storage is in hand.
//
// `get()` must return a stable reference for `useSyncExternalStore`, so the cache
// is only reassigned when something actually changed.

import { useSyncExternalStore } from "react";

import type { BoardState } from "../board/store";
import { byUpdatedDesc, type BoardStorage } from "./board-storage";
import {
  createBoardRecord,
  uniqueBoardName,
  type BoardRecord,
} from "./board-record";
import { loadLastOpenId, saveLastOpenId } from "./last-open";
import { deleteRemoteBoard } from "./remote";

export interface BoardLibrary {
  get(): BoardRecord[];
  ready(): boolean;
  degraded(): boolean;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  create(
    name: string,
    board?: BoardState,
    remote?: RemoteIdentity,
  ): Promise<BoardRecord>;
  rename(id: string, name: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  /**
   * Delete for real, where there is a server to delete from: the row goes, and
   * everything on it with it. Answers `false` when the server could not be told,
   * in which case nothing is removed here either — a board that is gone from the
   * list but still on the server is the one thing nobody can undo.
   */
  destroy(id: string): Promise<boolean>;
  /** What autosave writes. Discrete actions above write straight through. */
  saveDocument(id: string, board: BoardState): Promise<void>;
}

export interface BoardLibraryOptions {
  now?: () => number;
}

/**
 * The board's `boards` row, when it has one. Its id becomes the record's id, so
 * there is one id per board rather than a local one and a server one to keep in
 * step. Absent means the board never reached the server.
 *
 * The tokens are optional because only the person who *made* the board is given
 * them: `join_board` hands back a role and nothing else, so someone who arrived
 * by a link is a member without holding a link of their own.
 */
export interface RemoteIdentity {
  id: string;
  editToken?: string;
  viewToken?: string;
}

const EMPTY: BoardState = { entities: [], strings: [] };

export function createBoardLibrary(
  storage: BoardStorage,
  options: BoardLibraryOptions = {},
): BoardLibrary {
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();

  // A storage that can answer synchronously — the in-memory one — is answered
  // before any await, so its callers never see a loading frame.
  const immediate = storage.snapshot?.();
  let records: BoardRecord[] = immediate
    ? [...immediate].sort(byUpdatedDesc)
    : [];
  let ready = immediate !== undefined;

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const commit = (next: BoardRecord[]): void => {
    records = [...next].sort(byUpdatedDesc);
    emit();
  };

  const replace = (record: BoardRecord): void => {
    commit([
      record,
      ...records.filter((existing) => existing.id !== record.id),
    ]);
  };

  const find = (id: string): BoardRecord | undefined =>
    records.find((record) => record.id === id);

  /** Off this device, and out of the list. Whether it also left the server is
   *  `destroy`'s question, and it asks before getting here. */
  const forgetBoard = async (id: string): Promise<void> => {
    await storage.remove(id);
    commit(records.filter((record) => record.id !== id));
    // Otherwise `/` would try to open a board that is not there any more.
    if (loadLastOpenId() === id) saveLastOpenId(null);
  };

  return {
    get: () => records,
    ready: () => ready,
    degraded: () => storage.degraded?.() === true,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async refresh() {
      const loaded = await storage.list();
      ready = true;
      commit(loaded);
    },

    async create(name, board = EMPTY, remote) {
      const record: BoardRecord = createBoardRecord(
        uniqueBoardName(
          records.map((existing) => existing.name),
          name,
        ),
        board,
        now(),
        remote?.id,
      );
      if (remote) record.remote = true;
      if (remote?.editToken) record.editToken = remote.editToken;
      if (remote?.viewToken) record.viewToken = remote.viewToken;

      await storage.put(record);
      replace(record);
      return record;
    },

    async rename(id, name) {
      const trimmed = name.trim();
      if (trimmed === "") return false;
      const existing = find(id);
      if (!existing) return false;

      const renamed = { ...existing, name: trimmed, updatedAt: now() };
      await storage.put(renamed);
      replace(renamed);
      return true;
    },

    async remove(id) {
      await forgetBoard(id);
    },

    async destroy(id) {
      const record = find(id);
      if (!record) return true;
      // Somebody else's board is only ever forgotten here: RLS would refuse to
      // delete it, and the library says as much rather than pretending.
      if (record.remote === true && record.editToken !== undefined) {
        if (!(await deleteRemoteBoard(id))) return false;
      }
      await forgetBoard(id);
      return true;
    },

    async saveDocument(id, board) {
      const existing = find(id);
      // A board that is not in the library is one that was never saved: writing it
      // now would resurrect something the user deleted.
      if (!existing) return;

      const saved = { ...existing, board, updatedAt: now() };
      await storage.put(saved);
      replace(saved);
    },
  };
}

export function useLibrary(library: BoardLibrary): BoardRecord[] {
  return useSyncExternalStore(library.subscribe, library.get, library.get);
}
