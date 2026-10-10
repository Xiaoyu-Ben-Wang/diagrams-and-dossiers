import { afterEach, describe, expect, it, vi } from "vitest";

import { newFreePin } from "../model/create";
import type { BoardEntity } from "../model/types";
import {
  COALESCE_MS,
  RETRY_MS,
  createOutbox,
  changeId,
  type BoardWriter,
  type RowOutcome,
} from "./outbox";
import type { BoardChange, SyncOutcome } from "./transport";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function pin(id: string, bodyMd = ""): BoardEntity {
  return { ...newFreePin({ x: 0, y: 0 }, { id }), bodyMd };
}

function upsert(entity: BoardEntity): BoardChange {
  return { kind: "entity/upsert", entity };
}

// Built once: `newFreePin` stamps `Date.now()`, and under fake timers a rebuild
// would carry a different timestamp from the one that was sent.
const ONE = pin(A, "one");
const TWO = pin(A, "two");
const THREE = pin(A, "three");
const FIRST = pin(A, "first");
const SECOND = pin(A, "second");
const MINE = pin(A, "mine");
const THEIRS = pin(A, "theirs");
const BARE = pin(A);
const OTHER = pin(B, "other");

/** Resolutions are driven by the test, so "in flight" is an observable state. */
function controlledWriter() {
  const calls: { change: BoardChange; settle: (outcome: RowOutcome) => void }[] =
    [];
  const writer: BoardWriter = {
    write(change) {
      return new Promise<RowOutcome>((resolve) => {
        calls.push({ change, settle: resolve });
      });
    },
  };
  return { writer, calls };
}

function harness() {
  const { writer, calls } = controlledWriter();
  const applied: BoardChange[] = [];
  const outcomes: SyncOutcome[] = [];
  const outbox = createOutbox({
    writer,
    apply: (change) => applied.push(change),
    outcome: (outcome) => outcomes.push(outcome),
  });
  return { outbox, calls, applied, outcomes };
}

/** Lets the promise chain after a settle run to its end. */
async function settleNext(calls: { settle: (o: RowOutcome) => void }[], i = 0) {
  calls[i].settle({ kind: "ok" });
  await vi.advanceTimersByTimeAsync(0);
}

describe("the outbox", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses a burst on one thing into the last intent", async () => {
    vi.useFakeTimers();
    const { outbox, calls } = harness();

    outbox.send(upsert(ONE));
    outbox.send(upsert(TWO));
    outbox.send(upsert(THREE));
    await vi.advanceTimersByTimeAsync(COALESCE_MS);

    expect(calls).toHaveLength(1);
    expect(calls[0].change).toEqual(upsert(THREE));
  });

  it("keeps one write in flight per thing, and sends what arrived meanwhile after", async () => {
    vi.useFakeTimers();
    const { outbox, calls } = harness();

    outbox.send(upsert(FIRST));
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    expect(calls).toHaveLength(1);

    outbox.send(upsert(SECOND));
    await vi.advanceTimersByTimeAsync(COALESCE_MS * 4);
    // Still one: the second cannot go until the first has landed.
    expect(calls).toHaveLength(1);

    await settleNext(calls);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(calls[1].change).toEqual(upsert(SECOND));
  });

  it("does not make one thing wait on another", async () => {
    vi.useFakeTimers();
    const { outbox, calls } = harness();

    outbox.send(upsert(BARE));
    outbox.send(upsert(OTHER));
    await vi.advanceTimersByTimeAsync(COALESCE_MS);

    expect(calls.map((call) => changeId(call.change)).sort()).toEqual([A, B].sort());
  });

  it("tries again, further apart, when the network is what failed", async () => {
    vi.useFakeTimers();
    const { outbox, calls, outcomes } = harness();

    outbox.send(upsert(BARE));
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    calls[0].settle({ kind: "offline" });
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]);
    expect(calls).toHaveLength(2);
    // A retry is not a refusal, and nothing has been reported yet.
    expect(outcomes).toEqual([]);
  });

  it("takes the server's version when someone else wrote first", async () => {
    vi.useFakeTimers();
    const { outbox, calls, applied, outcomes } = harness();
    const theirs = upsert(THEIRS);

    outbox.send(upsert(MINE));
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    calls[0].settle({ kind: "stale", change: theirs });
    await vi.advanceTimersByTimeAsync(0);

    expect(applied).toEqual([theirs]);
    expect(outcomes).toEqual([
      { kind: "rejected", change: upsert(MINE), reason: "stale" },
    ]);
  });

  it("takes a deletion as final rather than putting the thing back", async () => {
    vi.useFakeTimers();
    const { outbox, calls, applied } = harness();

    outbox.send(upsert(BARE));
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    calls[0].settle({ kind: "missing" });
    await vi.advanceTimersByTimeAsync(0);

    expect(applied).toEqual([{ kind: "entity/delete", id: A }]);
  });

  it("does not retry a refusal that retrying cannot fix", async () => {
    vi.useFakeTimers();
    const { outbox, calls, outcomes } = harness();

    outbox.send(upsert(BARE));
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    calls[0].settle({ kind: "denied" });
    await vi.advanceTimersByTimeAsync(RETRY_MS[0] * 4);

    expect(calls).toHaveLength(1);
    expect(outcomes).toEqual([
      { kind: "rejected", change: upsert(BARE), reason: "denied" },
    ]);
  });

  it("knows its own echo, both while in flight and after the answer", async () => {
    vi.useFakeTimers();
    const { outbox, calls } = harness();
    const A_ID = changeId(upsert(BARE));

    outbox.send(upsert(BARE));
    // Queued: anything for this row is ours, whatever version it claims.
    expect(outbox.isOwn(A_ID, 7)).toBe(true);
    expect(outbox.isOwn("someone-else", 7)).toBe(false);

    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    calls[0].settle({ kind: "ok", version: 4 });
    await vi.advanceTimersByTimeAsync(0);

    // Settled: the version the server answered with is the echo to ignore, and
    // a later one is somebody else's news.
    expect(outbox.isOwn(A_ID, 4)).toBe(true);
    // An earlier write of ours, whose echo arrived out of order, is still ours.
    expect(outbox.isOwn(A_ID, 3)).toBe(true);
    expect(outbox.isOwn(A_ID, 5)).toBe(false);
  });

  it("reports a write that landed", async () => {
    vi.useFakeTimers();
    const { outbox, calls, outcomes } = harness();

    outbox.send(upsert(BARE));
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    await settleNext(calls);

    expect(outcomes).toEqual([{ kind: "confirmed", change: upsert(BARE) }]);
  });
});
