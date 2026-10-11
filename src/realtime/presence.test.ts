// The bug this encodes: presence is keyed by whatever ref the channel assigns,
// while cursors arrive keyed by user id. When the two were assumed to be the same
// thing, every peer came through with no position at all — presence said two
// people were in the room and the board drew nothing.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { setSupabaseForTests } from "../supabase/client";
import { boardPresence } from "./presence";

const BOARD = "11111111-1111-4111-8111-111111111111";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const THEM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function fakeClient() {
  let presenceState: Record<string, unknown[]> = {};
  let onPresence: (() => void) | null = null;
  let onBroadcast: ((msg: { payload: unknown }) => void) | null = null;
  let onStatus: ((status: string) => void) | null = null;
  let trackResult = "ok";
  const tracked: unknown[] = [];
  const sent: unknown[] = [];
  const channels: Record<string, unknown>[] = [];

  const makeChannel = (): Record<string, unknown> => {
    const channel: Record<string, unknown> = {
      on(type: string, _filter: unknown, callback: never) {
        if (type === "presence") onPresence = callback;
        if (type === "broadcast") onBroadcast = callback;
        return channel;
      },
      subscribe(callback: (status: string) => void) {
        onStatus = callback;
        callback("SUBSCRIBED");
        return channel;
      },
      track(payload: unknown) {
        tracked.push(payload);
        return Promise.resolve(trackResult);
      },
      send(message: unknown) {
        sent.push(message);
        return Promise.resolve("ok");
      },
      presenceState: () => presenceState,
      unsubscribe: () => Promise.resolve("ok"),
    };
    channels.push(channel);
    return channel;
  };

  const client = { channel: () => makeChannel() };
  return {
    client: client as unknown as SupabaseClient,
    tracked,
    sent,
    channels,
    /** What Supabase would report: keyed by its own ref, not by user. */
    setPresence(next: Record<string, unknown[]>) {
      presenceState = next;
    },
    syncPresence: () => onPresence?.(),
    receive: (payload: unknown) => onBroadcast?.({ payload }),
    /** What the server does to a channel it has decided to drop. */
    closeChannel: () => onStatus?.("CLOSED"),
    /** What a track reports back when the channel it went into is not there. */
    setTrackResult(next: string) {
      trackResult = next;
    },
  };
}

/** Lets a retry or a reopen fire, and the promises behind them settle. */
const later = (ms: number): Promise<void> =>
  vi.advanceTimersByTimeAsync(ms).then(() => undefined);

function open() {
  const fake = fakeClient();
  setSupabaseForTests(fake.client);
  const presence = boardPresence({ boardId: BOARD, userId: ME });
  return { ...fake, presence };
}

describe("who else is on the board", () => {
  afterEach(() => {
    setSupabaseForTests(null);
    vi.useRealTimers();
  });

  it("pairs a presence entry with the cursor that belongs to it", () => {
    const { presence, setPresence, syncPresence, receive } = open();

    // The channel's key is its own ref; the tracked record carries the user.
    setPresence({
      "0f1c-ref-not-a-user-id": [
        { userId: THEM, name: "Kael", color: "#c0392b" },
      ],
    });
    syncPresence();
    expect(presence.peers()).toHaveLength(1);

    receive({ userId: THEM, x: 120, y: 40 });

    expect(presence.peers()).toEqual([
      {
        userId: THEM,
        name: "Kael",
        color: "#c0392b",
        at: { x: 120, y: 40 },
        editing: null,
      },
    ]);
  });

  it("never lists you as someone else", () => {
    const { presence, setPresence, syncPresence } = open();

    setPresence({
      me: [{ userId: ME, name: "Me", color: "#000" }],
      them: [{ userId: THEM, name: "Kael", color: "#c0392b" }],
    });
    syncPresence();

    expect(presence.peers().map((peer) => peer.userId)).toEqual([THEM]);
  });

  it("says who you are, so the others have a name to draw", () => {
    const { presence, tracked } = open();

    presence.identify("Dungeon Master", "#2563a8");

    expect(tracked.at(-1)).toEqual({
      userId: ME,
      name: "Dungeon Master",
      color: "#2563a8",
      editing: null,
    });
  });

  it("sends a position in board coordinates, throttled", async () => {
    vi.useFakeTimers();
    const { presence, sent } = open();

    presence.move(1, 2);
    presence.move(3, 4);
    presence.move(5, 6);
    // Three moves, one send: the last position is the one that matters.
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "broadcast",
      event: "cursor",
      payload: { userId: ME, x: 5, y: 6 },
    });
  });

  it("says what it has the editor open on, and stops saying it", () => {
    const { presence, tracked } = open();

    presence.editing("note-1");
    expect(tracked.at(-1)).toMatchObject({ editing: "note-1" });

    presence.editing(null);
    expect(tracked.at(-1)).toMatchObject({ editing: null });
  });

  it("says it again when the send did not land", async () => {
    vi.useFakeTimers();
    const { presence, tracked, setTrackResult } = open();
    setTrackResult("timed out");

    // The message goes into a socket that never answers: nothing comes back, and
    // nothing about it is said again unless it is said here.
    presence.editing("note-1");
    const stuck = tracked.length;
    await later(5000);

    expect(stuck).toBeGreaterThan(0);
    expect(tracked.length).toBeGreaterThan(stuck);
    expect(tracked.at(-1)).toMatchObject({ editing: "note-1" });
  });

  it("opens the channel again when the server closes it", async () => {
    vi.useFakeTimers();
    const { channels, closeChannel, tracked } = open();
    expect(channels).toHaveLength(1);

    // Nothing comes back from a closed channel: no cursors, no locks, no error.
    closeChannel();
    await later(2000);

    expect(channels).toHaveLength(2);
    expect(tracked.at(-1)).toMatchObject({ editing: null });
  });

  it("reports who is holding what, by the thing they are holding", () => {
    const { presence, setPresence, syncPresence } = open();

    setPresence({
      them: [
        { userId: THEM, name: "Kael", color: "#c0392b", editing: "note-1" },
      ],
      me: [{ userId: ME, name: "Me", color: "#000", editing: "note-2" }],
    });
    syncPresence();

    // Yours is not a lock you need telling about, so it is not in the map.
    expect([...presence.editors().keys()]).toEqual(["note-1"]);
    expect(presence.editors().get("note-1")?.name).toBe("Kael");
  });

  it("lets go when the person does", () => {
    const { presence, setPresence, syncPresence } = open();
    setPresence({
      them: [
        { userId: THEM, name: "Kael", color: "#c0392b", editing: "note-1" },
      ],
    });
    syncPresence();
    expect(presence.editors().size).toBe(1);

    // Presence drops them the moment they close the tab, so the lock lifts itself —
    // which is the reason this is presence and not a row with a timeout on it.
    setPresence({});
    syncPresence();
    expect(presence.editors().size).toBe(0);
  });

  it("ignores its own cursor coming back", () => {
    const { presence, setPresence, syncPresence, receive } = open();
    setPresence({ me: [{ userId: ME, name: "Me", color: "#000" }] });
    syncPresence();

    receive({ userId: ME, x: 9, y: 9 });

    expect(presence.peers()).toEqual([]);
  });
});
