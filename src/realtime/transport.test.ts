import { describe, expect, it, vi } from "vitest";

import { newFreePin, newNote } from "../model/create";
import { DEFAULT_SLACK, YARN_COLOR } from "../board/yarn";
import { localSync, recordingSync, type BoardChange } from "./transport";

const string = () => ({
  id: "s1",
  from: "a",
  to: "b",
  slack: DEFAULT_SLACK,
  color: YARN_COLOR,
  style: "solid" as const,
  labelAt: 0.5,
  visibility: "shared" as const,
  version: 1,
});

describe("localSync", () => {
  it("reports itself offline, which is what a board with one person on it is", () => {
    expect(localSync().status()).toBe("offline");
  });

  it("takes a change and says so, without claiming it went anywhere", () => {
    expect(localSync().publish({ kind: "entity/delete", id: "x" })).toBe(
      "local",
    );
  });

  it("never delivers anything, because there is no one to deliver to", () => {
    const listener = vi.fn();
    const sync = localSync();
    const stop = sync.subscribe(listener);

    sync.publish({ kind: "entity/delete", id: "x" });

    expect(listener).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});

describe("recordingSync", () => {
  it("keeps what it was told, so a test can see the seam was used", () => {
    const sync = recordingSync();
    const pin = newFreePin({ x: 1, y: 2 });

    sync.publish({ kind: "entity/upsert", entity: pin });

    expect(sync.published).toEqual([{ kind: "entity/upsert", entity: pin }]);
  });

  it("fans a change out to whoever is listening", () => {
    const sync = recordingSync();
    const heard: BoardChange[] = [];
    sync.subscribe((change) => heard.push(change));

    const note = newNote({ x: 0, y: 0 });
    sync.publish({ kind: "entity/upsert", entity: note });

    expect(heard).toEqual([{ kind: "entity/upsert", entity: note }]);
  });

  it("stops delivering once unsubscribed", () => {
    const sync = recordingSync();
    const listener = vi.fn();
    const stop = sync.subscribe(listener);

    sync.publish({ kind: "string/delete", id: "s1" });
    stop();
    sync.publish({ kind: "string/delete", id: "s2" });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("carries a string as readily as an entity", () => {
    const sync = recordingSync();
    const link = string();

    sync.publish({ kind: "string/upsert", string: link });

    expect(sync.published).toEqual([{ kind: "string/upsert", string: link }]);
  });

  it("reports itself live", () => {
    expect(recordingSync().status()).toBe("live");
  });
});
