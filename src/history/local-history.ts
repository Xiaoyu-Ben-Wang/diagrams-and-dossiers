// Version history for boards that live only in this browser.
//
// Like the server's hourly job: the first change in each hour saves the board as
// it stood before that change, so a version is the state at the top of an hour.
// Changes inside the current hour are undo's job. Inline pictures are stored
// once per board under the hash of their data URL, so thirty days of snapshots
// of a board with pictures cost the pictures once rather than fifty times.

import deepEqual from "fast-deep-equal";

import type { BoardState } from "../board/store";
import { newBoardId } from "../boards/board-record";
import type { BoardEntity } from "../model/types";
import { HOUR_MS, planRecord, survivors } from "./retention";
import {
  getHistoryStore,
  type HistoryStore,
  type SnapshotRecord,
} from "./history-store";
import type { BoardHistory, SnapshotSummary } from "./types";

const PICTURE_REF = "snapshot-picture:";

export interface LocalHistory {
  /** Called with the board as it was before a change. */
  record(boardId: string, before: BoardState): void;
  /** Waits for anything still being written. */
  flush(): Promise<void>;
  forget(boardId: string): Promise<void>;
  forBoard(boardId: string): BoardHistory;
}

export interface LocalHistoryOptions {
  store?: HistoryStore;
  now?: () => number;
}

const hashes = new Map<string, string>();
const HASH_CACHE_LIMIT = 256;

async function sha256(text: string): Promise<string> {
  const cached = hashes.get(text);
  if (cached) return cached;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (hashes.size >= HASH_CACHE_LIMIT) hashes.clear();
  hashes.set(text, hex);
  return hex;
}

function isInlinePicture(entity: BoardEntity): entity is BoardEntity & {
  kind: "image";
  src: string;
} {
  return entity.kind === "image" && entity.src.startsWith("data:");
}

/** The board with each inline picture swapped for a reference to its stored copy. */
async function externalize(
  board: BoardState,
): Promise<{ board: BoardState; pictures: Map<string, string> }> {
  const pictures = new Map<string, string>();
  const entities = await Promise.all(
    board.entities.map(async (entity) => {
      if (!isInlinePicture(entity)) return entity;
      const key = await sha256(entity.src);
      pictures.set(key, entity.src);
      return { ...entity, src: `${PICTURE_REF}${key}` };
    }),
  );
  return { board: { entities, strings: board.strings }, pictures };
}

function pictureKeysIn(board: BoardState): string[] {
  return board.entities.flatMap((entity) =>
    entity.kind === "image" && entity.src.startsWith(PICTURE_REF)
      ? [entity.src.slice(PICTURE_REF.length)]
      : [],
  );
}

function summary(record: SnapshotRecord): SnapshotSummary {
  return {
    id: record.id,
    takenAt: record.takenAt,
    items: record.board.entities.length,
    strings: record.board.strings.length,
  };
}

export function createLocalHistory(
  options: LocalHistoryOptions = {},
): LocalHistory {
  const store = options.store ?? getHistoryStore();
  const now = options.now ?? Date.now;
  /** The hour each board was last offered in, so most saves cost nothing. */
  const offeredHour = new Map<string, number>();
  let chain: Promise<void> = Promise.resolve();

  const commit = async (boardId: string, board: BoardState, at: number) => {
    const outer = await externalize(board);
    const existing = await store.snapshots(boardId);
    const latest =
      existing.reduce<SnapshotRecord | null>(
        (best, each) => (best && best.takenAt >= each.takenAt ? best : each),
        null,
      ) ?? null;

    const plan = planRecord(
      latest,
      at,
      latest === null || !deepEqual(latest.board, outer.board),
      board.entities.length === 0 && board.strings.length === 0,
    );
    if (plan === "skip") return;

    for (const [key, src] of outer.pictures) {
      if (!(await store.hasPicture(boardId, key)))
        await store.putPicture({ boardId, key, src });
    }

    const written: SnapshotRecord = {
      id: newBoardId(),
      boardId,
      takenAt: at,
      board: outer.board,
    };
    await store.putSnapshot(written);

    const all = [...existing, written];
    const kept = survivors(all, at);
    const keptIds = new Set(kept.map((each) => each.id));
    const dropped = all.filter((each) => !keptIds.has(each.id));
    if (dropped.length > 0)
      await store.deleteSnapshots(dropped.map((each) => each.id));

    const referenced = new Set(
      kept.flatMap((each) => pictureKeysIn(each.board)),
    );
    const orphans = (await store.pictureKeys(boardId)).filter(
      (key) => !referenced.has(key),
    );
    if (orphans.length > 0) await store.deletePictures(boardId, orphans);
  };

  return {
    record(boardId, before) {
      const at = now();
      const hour = Math.floor(at / HOUR_MS);
      if (offeredHour.get(boardId) === hour) return;
      offeredHour.set(boardId, hour);
      chain = chain
        .then(() => commit(boardId, before, at))
        .catch((error) => {
          console.warn("board: could not save a version", error);
        });
    },

    async flush() {
      await chain;
    },

    async forget(boardId) {
      offeredHour.delete(boardId);
      chain = chain.then(async () => {
        const all = await store.snapshots(boardId);
        await store.deleteSnapshots(all.map((each) => each.id));
        await store.deletePictures(boardId, await store.pictureKeys(boardId));
      });
      const forgotten = chain;
      chain = chain.catch((error) => {
        console.warn("board: could not forget a board's versions", error);
      });
      await forgotten;
    },

    forBoard(boardId) {
      return {
        async list() {
          try {
            const all = await store.snapshots(boardId);
            return all.sort((a, b) => b.takenAt - a.takenAt).map(summary);
          } catch {
            return null;
          }
        },

        async load(id) {
          try {
            const found = (await store.snapshots(boardId)).find(
              (each) => each.id === id,
            );
            if (!found) return null;
            const entities: BoardEntity[] = [];
            for (const entity of found.board.entities) {
              if (
                entity.kind === "image" &&
                entity.src.startsWith(PICTURE_REF)
              ) {
                const src = await store.getPicture(
                  boardId,
                  entity.src.slice(PICTURE_REF.length),
                );
                // A picture whose stored copy is gone is left out rather than drawn broken.
                if (src === null) continue;
                entities.push({ ...entity, src });
              } else {
                entities.push(entity);
              }
            }
            return { entities, strings: found.board.strings };
          } catch {
            return null;
          }
        },
      };
    },
  };
}
