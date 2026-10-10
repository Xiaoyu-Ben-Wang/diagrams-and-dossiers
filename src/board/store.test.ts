import { describe, expect, it, vi } from "vitest";

import { newArticle, newFreePin, newNote } from "../model/create";
import { DEFAULT_ARTICLE_OPTIONS } from "../model/article-options";
import { recordingSync } from "../realtime/transport";
import type { BoardEntity } from "../model/types";
import {
  createBoardStore,
  GESTURE_QUIET_MS,
  TYPING_QUIET_MS,
  type BoardState,
} from "./store";
import { DEFAULT_SLACK, YARN_COLOR } from "./yarn";

function open(role: "viewer" | "editor" | "dm" | "owner" = "owner") {
  const sync = recordingSync();
  const store = createBoardStore({ sync, viewer: { role } });
  return { store, sync };
}

const link = (from: string, to: string, id = `${from}-${to}`) => ({
  id,
  from,
  to,
  slack: DEFAULT_SLACK,
  color: YARN_COLOR,
  style: "solid" as const,
  labelAt: 0.5,
  visibility: "shared" as const,
  version: 1,
});

describe("adding", () => {
  it("puts an entity on the board and publishes it", () => {
    const { store, sync } = open();
    const pin = newFreePin({ x: 1, y: 2 });

    store.addEntities([pin]);

    expect(store.get().entities).toEqual([pin]);
    expect(sync.published).toEqual([{ kind: "entity/upsert", entity: pin }]);
  });

  it("reads the board inside the change, not before it", () => {
    const { store } = open();

    for (let i = 0; i < 3; i += 1) {
      store.addEntities((state) => [
        newFreePin(
          { x: 0, y: 0 },
          { dateLabel: `Session ${state.entities.length + 12}` },
        ),
      ]);
    }

    expect(store.get().entities.map((entity) => entity.dateLabel)).toEqual([
      "Session 12",
      "Session 13",
      "Session 14",
    ]);
  });

  it("notifies subscribers once per change", () => {
    const { store } = open();
    const listener = vi.fn();
    store.subscribe(listener);

    store.addEntities([newFreePin({ x: 0, y: 0 })]);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the same state object when nothing was added", () => {
    const { store } = open();
    const before = store.get();

    store.addEntities([]);

    expect(store.get()).toBe(before);
  });

  it("adds a string, and refuses the same one twice", () => {
    const { store, sync } = open();

    store.addString(link("a", "b"));
    store.addString(link("a", "b", "another-id"));
    store.addString(link("b", "a", "backwards"));

    expect(store.get().strings).toHaveLength(1);
    expect(sync.published).toHaveLength(1);
  });
});

describe("removing", () => {
  it("takes an entity off and publishes a deletion, not a silence", () => {
    const { store, sync } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);
    sync.published.length = 0;

    store.removeEntities([pin.id]);

    expect(store.get().entities).toEqual([]);
    expect(sync.published).toEqual([{ kind: "entity/delete", id: pin.id }]);
  });

  it("takes with it any string that was tied to it", () => {
    // A string to something gone would be drawn to the board origin.
    const { store, sync } = open();
    const a = newFreePin({ x: 0, y: 0 });
    const b = newFreePin({ x: 1, y: 1 });
    store.addEntities([a, b]);
    store.addString(link(a.id, b.id));
    sync.published.length = 0;

    store.removeEntities([a.id]);

    expect(store.get().strings).toEqual([]);
    expect(sync.published).toEqual([
      { kind: "entity/delete", id: a.id },
      { kind: "string/delete", id: `${a.id}-${b.id}` },
    ]);
  });

  it("does nothing at all when the id is not on the board", () => {
    const { store, sync } = open();
    const before = store.get();

    store.removeEntities(["not-here"]);

    expect(store.get()).toBe(before);
    expect(sync.published).toEqual([]);
  });
});

describe("replacing the board", () => {
  it("puts the new board in place of the old one in a single change", () => {
    const { store } = open();
    store.addEntities([newFreePin({ x: 0, y: 0 })]);

    const seen: number[] = [];
    store.subscribe(() => seen.push(store.get().entities.length));

    const page = newArticle({ x: 5, y: 5 }, "# Loaded", "Loaded");
    const note = newNote({ x: 1, y: 1 });
    store.replaceAll({ entities: [page, note], strings: [] });

    expect(seen).toEqual([2]);
    expect(store.get().entities).toEqual([page, note]);
  });

  it("publishes what it replaced, rather than stranding peers on the old board", () => {
    const { store, sync } = open();

    store.replaceAll({ entities: [newFreePin({ x: 0, y: 0 })], strings: [] });

    expect(sync.published.map((change) => change.kind)).toEqual([
      "entity/upsert",
    ]);
  });

  it("copies, so the caller cannot edit the board through the object it kept", () => {
    const { store } = open();
    const incoming: BoardState = {
      entities: [newFreePin({ x: 0, y: 0 })],
      strings: [],
    };

    store.replaceAll(incoming);
    incoming.entities.push(newFreePin({ x: 9, y: 9 }));
    incoming.strings.push(link("a", "b"));

    expect(store.get().entities).toHaveLength(1);
    expect(store.get().strings).toHaveLength(0);
  });

  it("is refused for a viewer, like every other write", () => {
    const { store } = open("viewer");
    const before = store.get();

    store.replaceAll({ entities: [newFreePin({ x: 0, y: 0 })], strings: [] });

    expect(store.get()).toBe(before);
  });
});

describe("updating", () => {
  it("replaces what the change returns and publishes it", () => {
    const { store, sync } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);
    sync.published.length = 0;

    store.updateEntities([pin.id], (entity) => ({
      ...entity,
      bodyMd: "paid in silver",
    }));

    expect(store.get().entities[0].bodyMd).toBe("paid in silver");
    expect(sync.published).toEqual([
      { kind: "entity/upsert", entity: store.get().entities[0] },
    ]);
  });

  it('treats the same object back as "nothing needed doing"', () => {
    const { store, sync } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);
    sync.published.length = 0;
    const before = store.get();

    store.updateEntities([pin.id], (entity) => entity);

    expect(store.get()).toBe(before);
    expect(sync.published).toEqual([]);
  });

  it("leaves the entities it was not asked about alone, by identity", () => {
    const { store } = open();
    const a = newFreePin({ x: 0, y: 0 });
    const b = newFreePin({ x: 1, y: 1 });
    store.addEntities([a, b]);

    store.updateEntities([a.id], (entity) => ({
      ...entity,
      bodyMd: "changed",
    }));

    expect(store.get().entities[1]).toBe(b);
  });

  it("updates a string", () => {
    const { store, sync } = open();
    store.addString(link("a", "b"));
    sync.published.length = 0;

    store.updateStrings(["a-b"], (s) => ({ ...s, slack: 0.4 }));

    expect(store.get().strings[0].slack).toBe(0.4);
    expect(sync.published).toEqual([
      { kind: "string/upsert", string: store.get().strings[0] },
    ]);
  });
});

/** Not every entity carries a position, and the change sees the whole union. */
const movedTo =
  (x: number) =>
  (entity: BoardEntity): BoardEntity =>
    "board" in entity ? { ...entity, board: { ...entity.board, x } } : entity;

describe("a gesture in flight", () => {
  it("shows the move here and keeps it off the wire until it stops", async () => {
    vi.useFakeTimers();
    const { store, sync } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);
    sync.published.length = 0;

    store.previewEntities([pin.id], movedTo(50));
    store.previewEntities([pin.id], movedTo(90));

    // The person dragging sees it move...
    expect(store.get().entities[0]).toMatchObject({ board: { x: 90 } });
    // ...and the database has heard nothing, however many frames went by.
    expect(sync.published).toEqual([]);

    await vi.advanceTimersByTimeAsync(GESTURE_QUIET_MS + 20);

    // Let go, and it is written once, at where it ended up.
    expect(sync.published).toHaveLength(1);
    expect(sync.published[0]).toMatchObject({
      kind: "entity/upsert",
      entity: { board: { x: 90 } },
    });
  });

  it("keeps work nobody has written yet when someone else edits the same thing", () => {
    vi.useFakeTimers();
    const { store } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);

    // Words typed but not yet sent.
    store.previewEntities(
      [pin.id],
      (entity) => ({ ...entity, bodyMd: "the tide keeps" }),
      TYPING_QUIET_MS,
    );

    // A peer moves the note while those words are still only here.
    store.applyRemote({
      kind: "entity/upsert",
      entity: { ...pin, board: { x: 400, y: 0 }, version: 5 },
    });

    // Theirs survives, and so does ours — they touched different fields, and
    // neither edit was thrown away for it.
    expect(store.get().entities[0]).toMatchObject({
      bodyMd: "the tide keeps",
      board: { x: 400, y: 0 },
    });
  });

  it("writes what was typed once the typing stops", async () => {
    vi.useFakeTimers();
    const { store, sync } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);
    sync.published.length = 0;

    store.previewEntities(
      [pin.id],
      (entity) => ({ ...entity, bodyMd: "kept" }),
      TYPING_QUIET_MS,
    );
    expect(sync.published).toEqual([]);

    await vi.advanceTimersByTimeAsync(TYPING_QUIET_MS + 20);

    expect(sync.published).toHaveLength(1);
    expect(sync.published[0]).toMatchObject({
      kind: "entity/upsert",
      entity: { bodyMd: "kept" },
    });
  });

  it("is still one thing to undo", async () => {
    vi.useFakeTimers();
    const { store } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);

    for (let i = 1; i <= 20; i += 1) store.previewEntities([pin.id], movedTo(i));

    store.undo();

    expect(store.get().entities[0]).toMatchObject({ board: { x: 0 } });
  });
});

describe("undoing", () => {
  it("has nothing to undo on a board that has not been touched", () => {
    const { store } = open();

    expect(store.canUndo()).toBe(false);
    store.undo();

    expect(store.get()).toEqual({ entities: [], strings: [] });
  });

  it("puts back what a change replaced, and redo returns it", () => {
    const { store } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);
    store.updateEntities([pin.id], (entity) => ({
      ...entity,
      bodyMd: "paid in silver",
    }));

    store.undo();
    expect(store.get().entities[0].bodyMd).toBe(pin.bodyMd);

    store.redo();
    expect(store.get().entities[0].bodyMd).toBe("paid in silver");
  });

  it("brings a deleted entity back, with the strings it was holding", () => {
    const { store } = open();
    const a = newFreePin({ x: 0, y: 0 });
    const b = newFreePin({ x: 1, y: 1 });
    store.addEntities([a, b]);
    store.addString(link(a.id, b.id));
    store.removeEntities([b.id]);

    store.undo();

    expect(store.get().entities).toHaveLength(2);
    expect(store.get().strings).toHaveLength(1);
  });

  it("publishes what it put back, so peers see the undo and not a silence", () => {
    const { store, sync } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);
    store.updateEntities([pin.id], (entity) => ({ ...entity, bodyMd: "mine" }));
    sync.published.length = 0;

    store.undo();

    expect(sync.published).toEqual([
      { kind: "entity/upsert", entity: expect.objectContaining({ bodyMd: pin.bodyMd }) },
    ]);
  });

  it("keeps a peer's change to a field the step never touched", () => {
    const { store } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);
    store.updateEntities([pin.id], (entity) => ({ ...entity, bodyMd: "mine" }));
    store.applyRemote({
      kind: "entity/upsert",
      entity: { ...pin, bodyMd: "mine", title: "theirs", version: 2 },
    });

    store.undo();

    // The body comes back; the title the step never named is left alone.
    expect(store.get().entities[0]).toMatchObject({
      bodyMd: pin.bodyMd,
      title: "theirs",
    });
  });

  it("does not bring back what a peer has since deleted", () => {
    const { store } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);
    store.updateEntities([pin.id], (entity) => ({ ...entity, bodyMd: "mine" }));
    store.applyRemote({ kind: "entity/delete", id: pin.id });

    store.undo();

    expect(store.get().entities).toHaveLength(0);
  });

  it("leaves no step when a run ends where it started", () => {
    const { store } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);

    store.updateEntities([pin.id], movedTo(50));
    store.updateEntities([pin.id], movedTo(0));

    store.undo();

    // The run added no step, so this undo reached the creation underneath it.
    expect(store.get().entities).toHaveLength(0);
  });

  it("takes a whole drag as one step", () => {
    const { store } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);

    for (let i = 1; i <= 20; i += 1) {
      store.updateEntities([pin.id], movedTo(i));
    }

    store.undo();

    expect(store.get().entities[0]).toMatchObject({ board: { x: 0 } });
  });

  it("takes a pause as the end of one", () => {
    vi.useFakeTimers();
    try {
      const { store } = open();
      const pin = newFreePin({ x: 0, y: 0 });
      store.addEntities([pin]);
      store.updateEntities([pin.id], movedTo(1));

      vi.advanceTimersByTime(5000);
      store.updateEntities([pin.id], movedTo(2));

      store.undo();
      expect(store.get().entities[0]).toMatchObject({ board: { x: 1 } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fold a change to another entity into the run", () => {
    const { store } = open();
    const a = newFreePin({ x: 0, y: 0 });
    const b = newFreePin({ x: 0, y: 0 });
    store.addEntities([a, b]);

    store.updateEntities([a.id], movedTo(1));
    store.updateEntities([b.id], movedTo(1));

    store.undo();

    expect(store.get().entities).toMatchObject([
      { board: { x: 1 } },
      { board: { x: 0 } },
    ]);
  });

  it("leaves a creation out of the run before it", () => {
    const { store } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);
    store.updateEntities([pin.id], movedTo(5));
    store.addEntities([newFreePin({ x: 9, y: 9 })]);

    store.undo();

    expect(store.get().entities).toHaveLength(1);
    expect(store.get().entities[0]).toMatchObject({ board: { x: 5 } });
  });

  it("stops at the oldest step it kept rather than growing without end", () => {
    const { store } = open();
    const a = newFreePin({ x: 0, y: 0 });
    const b = newFreePin({ x: 1, y: 1 });
    store.addEntities([a, b]);
    for (let i = 0; i < 80; i += 1) {
      const id = i % 2 === 0 ? a.id : b.id;
      store.updateEntities([id], (entity) => ({ ...entity, bodyMd: `${i}` }));
    }

    let steps = 0;
    while (store.canUndo()) {
      store.undo();
      steps += 1;
    }

    expect(steps).toBe(60);
  });

  it("is not asked to undo somebody else's change", () => {
    const { store } = open();

    store.applyRemote({
      kind: "entity/upsert",
      entity: newFreePin({ x: 0, y: 0 }),
    });

    expect(store.canUndo()).toBe(false);
  });
});

describe("permissions", () => {
  it("lets a viewer read the board and change none of it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { store, sync } = open("viewer");
      const pin = newFreePin({ x: 0, y: 0 });

      store.addEntities([pin]);
      store.addString(link("a", "b"));
      store.updateEntities([pin.id], (entity) => ({ ...entity, bodyMd: "no" }));
      store.removeEntities([pin.id]);

      expect(store.get()).toEqual({ entities: [], strings: [] });
      expect(sync.published).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("lets an editor do all of it", () => {
    const { store } = open("editor");
    const pin = newFreePin({ x: 0, y: 0 });

    store.addEntities([pin]);
    store.updateEntities([pin.id], (entity) => ({ ...entity, bodyMd: "yes" }));
    store.removeEntities([pin.id]);

    expect(store.get().entities).toEqual([]);
  });

  it("drops an article whose own options forbid editing", () => {
    const { store } = open("owner");
    const sealed = {
      ...newArticle({ x: 0, y: 0 }, "body", "Title", {
        ...DEFAULT_ARTICLE_OPTIONS,
        editable: false,
      }),
    };
    store.addEntities([sealed]);

    store.updateEntities([sealed.id], (entity) => ({
      ...entity,
      bodyMd: "changed",
    }));

    expect(store.get().entities[0].bodyMd).toBe("body");
  });

  it("says so when the UI offers something the role refuses", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { store } = open("viewer");

      store.addEntities([newFreePin({ x: 0, y: 0 })]);

      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("changes from elsewhere", () => {
  it("applies an entity it has never seen", () => {
    const { store, sync } = open();
    const pin = newFreePin({ x: 0, y: 0 });

    store.applyRemote({ kind: "entity/upsert", entity: pin });

    expect(store.get().entities).toEqual([pin]);
    // Not sent back out: two clients echoing each other is a loop.
    expect(sync.published).toEqual([]);
  });

  it("applies a change to one it has", () => {
    const { store } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);

    store.applyRemote({
      kind: "entity/upsert",
      entity: { ...pin, bodyMd: "from the other side", version: pin.version + 1 },
    });

    expect(store.get().entities).toHaveLength(1);
    expect(store.get().entities[0].bodyMd).toBe("from the other side");
  });

  it("ignores a change it has already applied, however it arrives", () => {
    const { store } = open();
    const pin = newFreePin({ x: 0, y: 0 }, { id: "9".repeat(8) });
    store.addEntities([pin]);
    const fromElsewhere = { ...pin, bodyMd: "later", version: 4 };
    store.applyRemote({ kind: "entity/upsert", entity: fromElsewhere });

    store.applyRemote({ kind: "entity/upsert", entity: fromElsewhere });
    store.applyRemote({
      kind: "entity/upsert",
      entity: { ...pin, bodyMd: "older", version: 2 },
    });

    expect(store.get().entities[0].bodyMd).toBe("later");
  });

  it("deletes an entity and the strings hanging off it", () => {
    const { store } = open();
    const a = newFreePin({ x: 0, y: 0 });
    const b = newFreePin({ x: 1, y: 1 });
    store.addEntities([a, b]);
    store.addString(link(a.id, b.id));

    store.applyRemote({ kind: "entity/delete", id: a.id });

    expect(store.get().entities).toEqual([b]);
    expect(store.get().strings).toEqual([]);
  });

  it("ignores a deletion of something it never had", () => {
    const { store } = open();
    const before = store.get();

    store.applyRemote({ kind: "entity/delete", id: "never-existed" });

    expect(store.get()).toBe(before);
  });

  it("applies a change from a role that could not have made it locally", () => {
    const { store } = open("viewer");
    const pin = newFreePin({ x: 0, y: 0 });

    store.applyRemote({ kind: "entity/upsert", entity: pin });

    expect(store.get().entities).toEqual([pin]);
  });

  it("holds a string whose far end has not arrived yet, then lets it in", () => {
    const { store } = open();
    const a = newFreePin({ x: 0, y: 0 });
    const b = newFreePin({ x: 1, y: 1 });
    store.addEntities([a]);

    // Catch-up is not topological, so the tie can land before the thing it ties.
    store.applyRemote({ kind: "string/upsert", string: link(a.id, b.id) });
    expect(store.get().strings).toHaveLength(0);

    store.applyRemote({ kind: "entity/upsert", entity: b });
    expect(store.get().strings).toHaveLength(1);
  });

  it("drops a held string whose end is deleted before it ever arrived", () => {
    const { store } = open();
    const a = newFreePin({ x: 0, y: 0 });
    const b = newFreePin({ x: 1, y: 1 });
    store.addEntities([a]);

    store.applyRemote({ kind: "string/upsert", string: link(a.id, b.id) });
    store.applyRemote({ kind: "entity/upsert", entity: b });
    store.applyRemote({ kind: "entity/delete", id: b.id });

    expect(store.get().strings).toHaveLength(0);
  });

  it("asks for the board again when a write is refused, and settles", () => {
    const { store, sync } = open();
    const pin = newFreePin({ x: 0, y: 0 });
    store.addEntities([pin]);

    expect(store.resyncing()).toBe(false);
    sync.reject({ kind: "entity/upsert", entity: pin }, "stale");

    expect(store.resyncing()).toBe(true);
    expect(sync.resyncs()).toBe(1);

    // The catch-up that answers the resync is what settles it back down.
    store.applyRemote({
      kind: "entity/upsert",
      entity: { ...pin, bodyMd: "theirs", version: 2 },
    });
    expect(store.resyncing()).toBe(false);
  });
});

describe("subscribing", () => {
  it("stops notifying once unsubscribed", () => {
    const { store } = open();
    const listener = vi.fn();
    const stop = store.subscribe(listener);

    stop();
    store.addEntities([newFreePin({ x: 0, y: 0 })]);

    expect(listener).not.toHaveBeenCalled();
  });

  it("reports the transport state", () => {
    expect(open().store.status()).toBe("live");
  });

  it("carries a note as readily as a pin", () => {
    const { store } = open();
    const note = newNote({ x: 0, y: 0 });

    store.addEntities([note]);

    expect(store.get().entities[0].kind).toBe("note");
  });
});
