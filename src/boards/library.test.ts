// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { memoryBoardStorage } from "./board-storage";
import { createBoardRecord } from "./board-record";
import { createBoardLibrary } from "./library";
import { LAST_OPEN_KEY, saveLastOpenId } from "./last-open";

const board = { entities: [], strings: [] };

function fakeStorage() {
  const storage = memoryBoardStorage();
  return { storage };
}

describe("the board library", () => {
  it("is ready on the first render when its storage answers synchronously", () => {
    const ledger = createBoardRecord("Ledger", board, 1);
    const library = createBoardLibrary(memoryBoardStorage([ledger]));

    expect(library.ready()).toBe(true);
    expect(library.get().map((record) => record.name)).toEqual(["Ledger"]);
  });

  it("is not ready until it has loaded, when its storage cannot answer at once", async () => {
    // IndexedDB has no synchronous answer, so a caller gets a loading frame. The
    // memory adapter is the one that always can, which is what keeps it out of
    // the unit suite's way.
    const storage = { ...fakeStorage().storage };
    delete (storage as { snapshot?: unknown }).snapshot;
    const library = createBoardLibrary(storage);

    expect(library.ready()).toBe(false);

    await library.refresh();

    expect(library.ready()).toBe(true);
  });

  it("keeps the most recently changed board first", async () => {
    const library = createBoardLibrary(memoryBoardStorage());
    await library.create("first", board);
    await library.create("second", board);

    expect(library.get()[0].name).toBe("second");
  });

  it("does not let two boards share a name", async () => {
    const library = createBoardLibrary(memoryBoardStorage());
    await library.create("Ledger", board);

    const second = await library.create("Ledger", board);

    expect(second.name).toBe("Ledger (2)");
  });

  it("writes a new board before it reports it", async () => {
    const { storage } = fakeStorage();
    const library = createBoardLibrary(storage);

    const created = await library.create("Ledger", board);

    expect(await storage.get(created.id)).toEqual(created);
  });

  it("renames a board and dates the change", async () => {
    const storage = memoryBoardStorage();
    const ledger = createBoardRecord("Ledger", board, 1);
    await storage.put(ledger);
    const library = createBoardLibrary(storage, { now: () => 50 });
    await library.refresh();

    await library.rename(ledger.id, "  The Ledger  ");

    const renamed = library.get()[0];
    expect(renamed).toMatchObject({
      name: "The Ledger",
      createdAt: 1,
      updatedAt: 50,
    });
    expect((await storage.get(ledger.id))?.name).toBe("The Ledger");
  });

  it("refuses a name that is only spaces rather than saving a nameless board", async () => {
    const storage = memoryBoardStorage();
    const ledger = createBoardRecord("Ledger", board, 1);
    await storage.put(ledger);
    const library = createBoardLibrary(storage);
    await library.refresh();

    expect(await library.rename(ledger.id, "   ")).toBe(false);
    expect(library.get()[0].name).toBe("Ledger");
  });

  it("refuses to rename a board it does not have", async () => {
    const library = createBoardLibrary(memoryBoardStorage());

    expect(await library.rename("nobody", "Ledger")).toBe(false);
  });

  it("removes a board from the list and from storage", async () => {
    const { storage } = fakeStorage();
    const library = createBoardLibrary(storage);
    const created = await library.create("Ledger", board);

    await library.remove(created.id);

    expect(library.get()).toEqual([]);
    expect(await storage.get(created.id)).toBeNull();
  });

  it("forgets which board was last open when that board is deleted", async () => {
    saveLastOpenId("gone");
    const { storage } = fakeStorage();
    const library = createBoardLibrary(storage);
    const created = await library.create("Ledger", board);
    saveLastOpenId(created.id);

    await library.remove(created.id);

    expect(localStorage.getItem(LAST_OPEN_KEY)).toBeNull();
  });

  it("leaves the last-open board alone when a different one is deleted", async () => {
    const { storage } = fakeStorage();
    const library = createBoardLibrary(storage);
    const doomed = await library.create("Doomed", board);
    const kept = await library.create("Kept", board);
    saveLastOpenId(kept.id);

    await library.remove(doomed.id);

    expect(localStorage.getItem(LAST_OPEN_KEY)).toBe(kept.id);
  });

  it("saves the document and moves the board to the top", async () => {
    const storage = memoryBoardStorage();
    const older = createBoardRecord("Older", board, 1);
    const newer = createBoardRecord("Newer", board, 5);
    await storage.put(older);
    await storage.put(newer);
    const library = createBoardLibrary(storage, { now: () => 100 });
    await library.refresh();
    expect(library.get()[0].id).toBe(newer.id);

    await library.saveDocument(older.id, { entities: [], strings: [] });

    expect(library.get()[0].id).toBe(older.id);
    expect(library.get()[0].updatedAt).toBe(100);
    expect((await storage.get(older.id))?.updatedAt).toBe(100);
  });

  it("does not resurrect a board that is not in the library", async () => {
    const { storage } = fakeStorage();
    const library = createBoardLibrary(storage);

    await library.saveDocument("deleted-behind-us", board);

    expect(library.get()).toEqual([]);
    expect(await storage.list()).toEqual([]);
  });

  it("tells its subscribers once per change", async () => {
    const library = createBoardLibrary(memoryBoardStorage());
    const seen = vi.fn();
    library.subscribe(seen);

    await library.create("Ledger", board);

    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("stops telling a subscriber that has gone away", async () => {
    const library = createBoardLibrary(memoryBoardStorage());
    const seen = vi.fn();
    const stop = library.subscribe(seen);
    stop();

    await library.create("Ledger", board);

    expect(seen).not.toHaveBeenCalled();
  });

  it("reports that its storage is only standing in", () => {
    expect(
      createBoardLibrary(memoryBoardStorage([], { degraded: true })).degraded(),
    ).toBe(true);
    expect(createBoardLibrary(memoryBoardStorage()).degraded()).toBe(false);
  });
});
