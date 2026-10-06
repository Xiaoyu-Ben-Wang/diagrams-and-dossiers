// The durable adapter, and the one place that admits when it is not durable.
//
// Every failure — no IndexedDB at all, a blocked open, a transaction that aborts
// on quota — falls back to a map for the rest of the session rather than throwing
// into the UI, and reports `degraded()` so the board can say so. Silence would be
// the wrong default here in a way it is not for preferences: a board is a whole
// session's work, and losing it without a word is the worst outcome available.

import {
  memoryBoardStorage,
  byUpdatedDesc,
  type BoardStorage,
} from "./board-storage";
import { parseBoardRecord, type BoardRecord } from "./board-record";

const DB_NAME = "detective-board";
const DB_VERSION = 1;
const STORE = "boards";

export function indexedDbBoardStorage(): BoardStorage {
  if (typeof indexedDB === "undefined") {
    return memoryBoardStorage([], { degraded: true });
  }

  const fallback = memoryBoardStorage();
  let degraded = false;
  let opening: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }

      // A ladder, never a drop-and-recreate: that would take every board with it.
      request.onupgradeneeded = (event) => {
        if (event.oldVersion < 1)
          request.result.createObjectStore(STORE, { keyPath: "id" });
        // if (event.oldVersion < 2) request.transaction?.objectStore(STORE).createIndex(...)
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("could not open the board store"));
      request.onblocked = () =>
        reject(new Error("another tab is holding the board store open"));
    });
    return opening;
  };

  /** Resolves on commit, not on the request: a quota failure arrives at the commit. */
  const withStore = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      let result: T;
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => {
        result = request.result as T;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("the write was rolled back"));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("the write failed"));
      request.onerror = () =>
        reject(request.error ?? new Error("the request failed"));
    });
  };

  const usingFallback = <T>(
    work: () => Promise<T>,
    spare: () => Promise<T>,
  ): Promise<T> =>
    work().catch(() => {
      degraded = true;
      return spare();
    });

  return {
    degraded: () => degraded,

    list: () =>
      usingFallback(
        () =>
          withStore<unknown[]>("readonly", (store) => store.getAll()).then(
            (rows) =>
              rows
                .map(parseBoardRecord)
                .filter((record): record is BoardRecord => record !== null)
                .sort(byUpdatedDesc),
          ),
        () => fallback.list(),
      ),

    get: (id) =>
      usingFallback(
        () =>
          withStore<unknown>("readonly", (store) => store.get(id)).then(
            (row) => (row === undefined ? null : parseBoardRecord(row)),
          ),
        () => fallback.get(id),
      ),

    put: (record) =>
      usingFallback(
        () => withStore<void>("readwrite", (store) => store.put(record)),
        () => fallback.put(record),
      ),

    remove: (id) =>
      usingFallback(
        () => withStore<void>("readwrite", (store) => store.delete(id)),
        () => fallback.remove(id),
      ),
  };
}
