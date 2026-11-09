import { describe, expect, it } from "vitest";

import type { BoardState } from "../board/store";
import type { BoardEntity } from "../model/types";
import { memoryHistoryStore } from "./history-store";
import { createLocalHistory } from "./local-history";
import { HOUR_MS } from "./retention";

const BOARD = "board-1";
const PICTURE = `data:image/png;base64,${"A".repeat(4000)}`;

function picture(id: string, src = PICTURE): BoardEntity {
  return { id, kind: "image", src } as unknown as BoardEntity;
}

function note(id: string): BoardEntity {
  return { id, kind: "note", bodyMd: id } as unknown as BoardEntity;
}

const board = (...entities: BoardEntity[]): BoardState => ({
  entities,
  strings: [],
});

function setup() {
  let clock = 10 * HOUR_MS + 1000;
  const store = memoryHistoryStore();
  const history = createLocalHistory({ store, now: () => clock });
  /** What the library does on a save: offers the board as it was before it. */
  const changeFrom = async (before: BoardState) => {
    history.record(BOARD, before);
    await history.flush();
  };
  return {
    store,
    history,
    changeFrom,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("createLocalHistory", () => {
  it("saves the state an hour began with, once per hour", async () => {
    const { history, changeFrom, advance } = setup();

    await changeFrom(board(note("a")));
    await changeFrom(board(note("a"), note("b")));

    const list = (await history.forBoard(BOARD).list())!;
    expect(list).toHaveLength(1);
    expect(list[0].items).toBe(1);

    advance(HOUR_MS);
    await changeFrom(board(note("a"), note("b")));
    expect(await history.forBoard(BOARD).list()).toHaveLength(2);
  });

  it("keeps what a later change in the hour deleted", async () => {
    const { history, changeFrom } = setup();

    await changeFrom(board(note("a")));
    await changeFrom(board());

    const [only] = (await history.forBoard(BOARD).list())!;
    expect((await history.forBoard(BOARD).load(only.id))?.entities).toEqual([
      note("a"),
    ]);
  });

  it("skips an hour whose board matches the last version", async () => {
    const { history, changeFrom, advance } = setup();

    await changeFrom(board(note("a")));
    advance(HOUR_MS);
    await changeFrom(board(note("a")));

    expect(await history.forBoard(BOARD).list()).toHaveLength(1);
  });

  it("starts no history for a board that was empty", async () => {
    const { history, changeFrom } = setup();
    await changeFrom(board());
    expect(await history.forBoard(BOARD).list()).toEqual([]);
  });

  it("stores a picture once and gives it back on load", async () => {
    const { store, history, changeFrom, advance } = setup();

    await changeFrom(board(picture("p")));
    advance(HOUR_MS);
    await changeFrom(board(picture("p"), note("n")));

    expect(await store.pictureKeys(BOARD)).toHaveLength(1);
    for (const snapshot of await store.snapshots(BOARD)) {
      const image = snapshot.board.entities.find((each) => each.id === "p") as {
        src: string;
      };
      expect(image.src.startsWith("data:")).toBe(false);
    }

    const [newest] = (await history.forBoard(BOARD).list())!;
    const loaded = await history.forBoard(BOARD).load(newest.id);
    expect(loaded?.entities).toEqual([picture("p"), note("n")]);
  });

  it("lets go of a picture once no version refers to it", async () => {
    const { store, changeFrom, advance } = setup();

    await changeFrom(board(picture("p")));
    // Past the 30 days, the newest version is the only one kept.
    advance(40 * 24 * HOUR_MS);
    await changeFrom(board(note("n")));

    expect(await store.snapshots(BOARD)).toHaveLength(1);
    expect(await store.pictureKeys(BOARD)).toEqual([]);
  });

  it("forgets a board's history entirely", async () => {
    const { store, history, changeFrom } = setup();
    await changeFrom(board(picture("p")));

    await history.forget(BOARD);

    expect(await store.snapshots(BOARD)).toEqual([]);
    expect(await store.pictureKeys(BOARD)).toEqual([]);
  });
});
