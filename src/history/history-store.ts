// Where local snapshots are kept: IndexedDB, in a database of its own so the
// boards database never needs an upgrade for it. Falls back to memory, like the
// board storage does, when IndexedDB is missing or refuses.

import type { BoardState } from "../board/store";

export interface SnapshotRecord {
  id: string;
  boardId: string;
  takenAt: number;
  board: BoardState;
}

export interface PictureRecord {
  boardId: string;
  key: string;
  src: string;
}

export interface HistoryStore {
  snapshots(boardId: string): Promise<SnapshotRecord[]>;
  putSnapshot(record: SnapshotRecord): Promise<void>;
  deleteSnapshots(ids: readonly string[]): Promise<void>;
  pictureKeys(boardId: string): Promise<string[]>;
  hasPicture(boardId: string, key: string): Promise<boolean>;
  getPicture(boardId: string, key: string): Promise<string | null>;
  putPicture(record: PictureRecord): Promise<void>;
  deletePictures(boardId: string, keys: readonly string[]): Promise<void>;
}

export function memoryHistoryStore(): HistoryStore {
  const snapshots = new Map<string, SnapshotRecord>();
  const pictures = new Map<string, PictureRecord>();
  const pictureId = (boardId: string, key: string) => `${boardId}:${key}`;

  return {
    async snapshots(boardId) {
      return [...snapshots.values()].filter((each) => each.boardId === boardId);
    },
    async putSnapshot(record) {
      snapshots.set(record.id, record);
    },
    async deleteSnapshots(ids) {
      for (const id of ids) snapshots.delete(id);
    },
    async pictureKeys(boardId) {
      return [...pictures.values()]
        .filter((each) => each.boardId === boardId)
        .map((each) => each.key);
    },
    async hasPicture(boardId, key) {
      return pictures.has(pictureId(boardId, key));
    },
    async getPicture(boardId, key) {
      return pictures.get(pictureId(boardId, key))?.src ?? null;
    },
    async putPicture(record) {
      pictures.set(pictureId(record.boardId, record.key), record);
    },
    async deletePictures(boardId, keys) {
      for (const key of keys) pictures.delete(pictureId(boardId, key));
    },
  };
}

const DB_NAME = "detective-board-history";
const DB_VERSION = 1;
const SNAPSHOTS = "snapshots";
const PICTURES = "pictures";
const BY_BOARD = "boardId";

export function indexedDbHistoryStore(): HistoryStore {
  if (typeof indexedDB === "undefined") return memoryHistoryStore();

  const fallback = memoryHistoryStore();
  let failed = false;
  let opening: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        if (event.oldVersion < 1) {
          const db = request.result;
          db.createObjectStore(SNAPSHOTS, { keyPath: "id" }).createIndex(
            BY_BOARD,
            "boardId",
          );
          db.createObjectStore(PICTURES, {
            keyPath: ["boardId", "key"],
          }).createIndex(BY_BOARD, "boardId");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("could not open the history store"));
      request.onblocked = () =>
        reject(new Error("another tab is holding the history store open"));
    });
    return opening;
  };

  /** Resolves on commit, so a quota failure is a failure. */
  const transact = async <T>(
    storeName: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest | void,
  ): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      let result: T;
      const request = run(transaction.objectStore(storeName));
      if (request)
        request.onsuccess = () => {
          result = request.result as T;
        };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("the write was rolled back"));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("the write failed"));
    });
  };

  const guarded =
    <A extends unknown[], T>(
      work: (...args: A) => Promise<T>,
      spare: (...args: A) => Promise<T>,
    ) =>
    (...args: A): Promise<T> =>
      failed
        ? spare(...args)
        : work(...args).catch(() => {
            failed = true;
            return spare(...args);
          });

  return {
    snapshots: guarded(
      (boardId) =>
        transact<SnapshotRecord[]>(SNAPSHOTS, "readonly", (store) =>
          store.index(BY_BOARD).getAll(boardId),
        ),
      fallback.snapshots,
    ),
    putSnapshot: guarded(
      (record) =>
        transact<void>(SNAPSHOTS, "readwrite", (store) => store.put(record)),
      fallback.putSnapshot,
    ),
    deleteSnapshots: guarded(
      (ids) =>
        transact<void>(SNAPSHOTS, "readwrite", (store) => {
          for (const id of ids) store.delete(id);
        }),
      fallback.deleteSnapshots,
    ),
    pictureKeys: guarded(
      (boardId) =>
        transact<IDBValidKey[]>(PICTURES, "readonly", (store) =>
          store.index(BY_BOARD).getAllKeys(boardId),
        ).then((keys) =>
          keys.map((each) => String((each as [string, string])[1])),
        ),
      fallback.pictureKeys,
    ),
    hasPicture: guarded(
      (boardId, key) =>
        transact<number>(PICTURES, "readonly", (store) =>
          store.count([boardId, key]),
        ).then((count) => count > 0),
      fallback.hasPicture,
    ),
    getPicture: guarded(
      (boardId, key) =>
        transact<PictureRecord | undefined>(PICTURES, "readonly", (store) =>
          store.get([boardId, key]),
        ).then((record) => record?.src ?? null),
      fallback.getPicture,
    ),
    putPicture: guarded(
      (record) =>
        transact<void>(PICTURES, "readwrite", (store) => store.put(record)),
      fallback.putPicture,
    ),
    deletePictures: guarded(
      (boardId, keys) =>
        transact<void>(PICTURES, "readwrite", (store) => {
          for (const key of keys) store.delete([boardId, key]);
        }),
      fallback.deletePictures,
    ),
  };
}

let shared: HistoryStore | null = null;

export function getHistoryStore(): HistoryStore {
  shared ??= indexedDbHistoryStore();
  return shared;
}
