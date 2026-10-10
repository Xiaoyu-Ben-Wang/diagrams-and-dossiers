// The three-way question PostgREST will not answer: a zero-row update is either a
// lost race, a row someone deleted, or a refusal, and all three come back as an
// empty result and no error. Only reading the row tells them apart.
import { afterEach, describe, expect, it, vi } from "vitest";

import { newFreePin } from "../model/create";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setSupabaseForTests } from "../supabase/client";
import { entityToRow, rowToEntity } from "./mapper";
import { supabaseSync } from "./supabase-sync";
import { COALESCE_MS } from "./outbox";
import type { BoardChange, SyncOutcome } from "./transport";

const BOARD = "11111111-1111-4111-8111-111111111111";
const USER = "99999999-9999-4999-8999-999999999999";
const PIN = "44444444-4444-4444-8444-444444444444";

const pin = { ...newFreePin({ x: 1, y: 2 }, { id: PIN }), bodyMd: "mine" };

/** What the server would hold, in the shape a read-back actually returns. */
function stored(entity: typeof pin, version: number) {
  return { ...entityToRow(entity, BOARD), version, created_by: null };
}

interface Call {
  table: string;
  op: string;
  payload: unknown;
  filters: Record<string, unknown>;
  single: boolean;
}

interface Reply {
  data: unknown;
  error: unknown;
}

/** Enough of the PostgREST builder for the chains the sync actually uses. */
function fakeClient(respond: (call: Call) => Reply) {
  const inFlight: Call[] = [];

  const builder = (call: Call): unknown => {
    const api: Record<string, unknown> = {
      update(payload: unknown) {
        call.op = "update";
        call.payload = payload;
        return api;
      },
      insert(payload: unknown) {
        call.op = "insert";
        call.payload = payload;
        return api;
      },
      delete() {
        call.op = "delete";
        return api;
      },
      select() {
        call.op = call.op || "select";
        return api;
      },
      eq(column: string, value: unknown) {
        call.filters[column] = value;
        return api;
      },
      gte() {
        return api;
      },
      maybeSingle() {
        call.single = true;
        return api;
      },
      // PostgREST's builder is awaited directly, so the fake has to be thenable
      // to model it. Nothing else here is ever awaited by accident.
      // oxlint-disable-next-line unicorn/no-thenable
      then(resolve: (value: Reply) => unknown) {
        return Promise.resolve(respond(call)).then(resolve);
      },
    };
    return api;
  };

  const rows: Record<string, (payload: unknown) => void> = {};
  const channel = {
    on(type: string, filter: { table?: string }, callback: (p: unknown) => void) {
      if (type === "postgres_changes" && filter?.table) rows[filter.table] = callback;
      return channel;
    },
    subscribe(callback: (status: string) => void) {
      callback("SUBSCRIBED");
      return channel;
    },
    unsubscribe: () => Promise.resolve("ok"),
  };

  const client = {
    from(table: string) {
      const call: Call = { table, op: "", payload: undefined, filters: {}, single: false };
      inFlight.push(call);
      return builder(call);
    },
    channel() {
      return channel;
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    inFlight,
    /** What `postgres_changes` would deliver for a row. */
    deliver: (table: string, payload: unknown) => rows[table]?.(payload),
  };
}

function open(respond: (call: Call) => Reply) {
  const { client, deliver } = fakeClient(respond);
  setSupabaseForTests(client);

  const received: BoardChange[] = [];
  const outcomes: SyncOutcome[] = [];
  const sync = supabaseSync({
    boardId: BOARD,
    userId: USER,
    initial: { entities: [pin], strings: [] },
  });
  sync.subscribe((change) => received.push(change));
  sync.onOutcome((outcome) => outcomes.push(outcome));
  return { sync, received, outcomes, deliver };
}

/** Sends `change` and lets the write, its read-back and the outcome settle. */
async function publishAndSettle(
  sync: ReturnType<typeof open>["sync"],
  change: BoardChange,
) {
  sync.publish(change);
  await vi.advanceTimersByTimeAsync(COALESCE_MS);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

describe("a write that matched no row", () => {
  afterEach(() => {
    setSupabaseForTests(null);
    vi.useRealTimers();
  });

  it("takes the server's row when someone else got there first", async () => {
    vi.useFakeTimers();
    const theirsRow = stored({ ...pin, bodyMd: "theirs" }, 2);

    const { sync, received, outcomes } = open((call) => {
      if (call.op === "update") return { data: [], error: null };
      if (call.op === "select" && call.filters.id === PIN) {
        return { data: theirsRow, error: null };
      }
      return { data: [], error: null };
    });

    await publishAndSettle(sync, { kind: "entity/upsert", entity: pin });

    expect(received).toEqual([
      { kind: "entity/upsert", entity: rowToEntity(theirsRow) },
    ]);
    expect(outcomes).toEqual([
      {
        kind: "rejected",
        change: { kind: "entity/upsert", entity: pin },
        reason: "stale",
      },
    ]);
  });

  it("calls it missing when the row is gone", async () => {
    vi.useFakeTimers();
    const { sync, received, outcomes } = open((call) => {
      if (call.op === "update") return { data: [], error: null };
      if (call.op === "select" && call.filters.id === PIN) {
        return { data: null, error: null };
      }
      return { data: [], error: null };
    });

    await publishAndSettle(sync, { kind: "entity/upsert", entity: pin });

    expect(received).toEqual([{ kind: "entity/delete", id: PIN }]);
    expect(outcomes[0]).toMatchObject({ kind: "rejected", reason: "missing" });
  });

  it("calls it a refusal when the row is readable and unchanged", async () => {
    vi.useFakeTimers();
    // Version 1, which is what we based the write on: nothing raced us, so the
    // refusal was about permission — and retrying that fixes nothing.
    const { sync, received, outcomes } = open((call) => {
      if (call.op === "update") return { data: [], error: null };
      if (call.op === "select" && call.filters.id === PIN) {
        return { data: stored(pin, 1), error: null };
      }
      return { data: [], error: null };
    });

    await publishAndSettle(sync, { kind: "entity/upsert", entity: pin });

    expect(received).toEqual([]);
    expect(outcomes[0]).toMatchObject({ kind: "rejected", reason: "denied" });
  });

  it("takes a refusal that names itself without reading the row back", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const { sync, outcomes } = open((call) => {
      if (call.op === "update") {
        return {
          data: null,
          error: { code: "42501", message: "new row violates row-level security policy" },
        };
      }
      if (call.op === "select" && call.filters.id === PIN) reads += 1;
      return { data: [], error: null };
    });

    await publishAndSettle(sync, { kind: "entity/upsert", entity: pin });

    expect(reads).toBe(0);
    expect(outcomes[0]).toMatchObject({ kind: "rejected", reason: "denied" });
  });

  it("confirms a write that matched its row", async () => {
    vi.useFakeTimers();
    const { sync, outcomes } = open((call) =>
      call.op === "update"
        ? { data: [{ ...pin, version: 2 }], error: null }
        : { data: [], error: null },
    );

    await publishAndSettle(sync, { kind: "entity/upsert", entity: pin });

    expect(outcomes).toEqual([
      { kind: "confirmed", change: { kind: "entity/upsert", entity: pin } },
    ]);
  });
});

describe("a row the server sends back", () => {
  afterEach(() => {
    setSupabaseForTests(null);
    vi.useRealTimers();
  });

  const rowAt = (version: number) => ({
    ...entityToRow(pin, BOARD),
    version,
    created_by: null,
  });

  it("is not news when it is this client's own write coming back", async () => {
    vi.useFakeTimers();
    // The write lands as version 2, and the echo of it arrives saying version 2.
    const { sync, received, deliver } = open((call) =>
      call.op === "update"
        ? { data: [rowAt(2)], error: null }
        : { data: [], error: null },
    );

    await publishAndSettle(sync, { kind: "entity/upsert", entity: pin });
    deliver("items", { eventType: "UPDATE", new: rowAt(2), old: { id: PIN } });

    // Reporting it would drag the thing back a round trip behind the pointer.
    expect(received).toEqual([]);
  });

  it("ignores an earlier echo of ours that arrives late", async () => {
    vi.useFakeTimers();
    // A drag writes several times and the echoes do not come back in order. An
    // older one applied late would drag the note backwards after it was dropped.
    const { sync, received, deliver } = open((call) =>
      call.op === "update"
        ? { data: [rowAt(6)], error: null }
        : { data: [], error: null },
    );

    await publishAndSettle(sync, { kind: "entity/upsert", entity: pin });
    deliver("items", { eventType: "UPDATE", new: rowAt(4), old: { id: PIN } });
    deliver("items", { eventType: "UPDATE", new: rowAt(5), old: { id: PIN } });

    expect(received).toEqual([]);
  });

  it("is news when someone else moved it on", async () => {
    vi.useFakeTimers();
    const { sync, received, deliver } = open((call) =>
      call.op === "update"
        ? { data: [rowAt(2)], error: null }
        : { data: [], error: null },
    );

    await publishAndSettle(sync, { kind: "entity/upsert", entity: pin });
    deliver("items", { eventType: "UPDATE", new: rowAt(3), old: { id: PIN } });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: "entity/upsert" });
  });
});
