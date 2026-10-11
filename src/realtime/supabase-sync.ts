/**
 * The live board, over one Supabase channel.
 *
 * Commits travel as `postgres_changes` (RLS-aware, and durable — a row is written
 * before anyone hears about it), while in-flight drags and cursors will go over
 * broadcast, which is ephemeral and never touches the database. Only the first of
 * those exists yet.
 *
 * The version predicate is the whole concurrency story: a write says which version
 * it is based on and matches nothing if someone else got there first. PostgREST
 * reports that and an RLS refusal identically — an empty result and no error — so
 * the two are told apart by reading the row back.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";

import type { BoardState } from "../board/store";
import { getSupabase } from "../supabase/client";
import { loadBoard } from "./load";
import { entityToRow, rowToEntity, rowToString, stringToRow } from "./mapper";
import { createOutbox, type BoardWriter, type RowOutcome } from "./outbox";
import type {
  BoardChange,
  BoardSync,
  PublishResult,
  SyncOutcome,
  SyncStatus,
} from "./transport";

type Table = "items" | "strings";

export interface SupabaseSyncOptions {
  boardId: string;
  userId: string;
  /** What the board held when it was opened, so a write knows if the row is new. */
  initial: BoardState;
}

interface PgPayload {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: unknown;
  old: unknown;
}

function tableOf(change: BoardChange): Table {
  return change.kind === "string/upsert" || change.kind === "string/delete"
    ? "strings"
    : "items";
}

function asChange(table: Table, row: unknown): BoardChange {
  return table === "items"
    ? { kind: "entity/upsert", entity: rowToEntity(row) }
    : { kind: "string/upsert", string: rowToString(row) };
}

function classify(error: { code?: string; message?: string }): RowOutcome {
  const message = error.message ?? "";
  if (
    error.code === "42501" ||
    /row-level security|permission denied/i.test(message)
  ) {
    return { kind: "denied" };
  }
  return { kind: "offline" };
}

function isDuplicate(error: { code?: string }): boolean {
  return error.code === "23505";
}

export function supabaseSync({
  boardId,
  userId,
  initial,
}: SupabaseSyncOptions): BoardSync {
  const listeners = new Set<(change: BoardChange) => void>();
  const outcomes = new Set<(outcome: SyncOutcome) => void>();
  const watchers = new Set<(status: SyncStatus) => void>();

  /** The version each row was last seen at. Absent means it is not on the server. */
  const known = new Map<string, number>();

  let status: SyncStatus = "offline";

  const setStatus = (next: SyncStatus): void => {
    if (status === next) return;
    status = next;
    for (const watcher of watchers) watcher(next);
  };
  let channel: RealtimeChannel | null = null;
  let disposed = false;
  /** When this client last knew it was up to date; catch-up starts from here. */
  let lastSeen = Date.now();

  for (const entity of initial.entities) known.set(entity.id, entity.version);
  for (const link of initial.strings) known.set(link.id, link.version);

  const emit = (change: BoardChange): void => {
    for (const listener of listeners) listener(change);
  };
  const tell = (outcome: SyncOutcome): void => {
    for (const listener of outcomes) listener(outcome);
  };

  const readRow = async (table: Table, id: string): Promise<unknown | null> => {
    const { data, error } = await getSupabase()
      .from(table)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  };

  /**
   * A zero-row update is either "someone was faster" or "you may not write this",
   * and PostgREST does not distinguish them. Reading the row does: still there and
   * newer is stale, gone is missing, and readable-but-unchanged means the refusal
   * was about permission, which is not something retrying will fix.
   */
  const discriminate = async (
    table: Table,
    id: string,
    base: number,
  ): Promise<RowOutcome> => {
    const row = (await readRow(table, id)) as { version?: number } | null;
    if (!row) return { kind: "missing" };
    if (typeof row.version === "number" && row.version > base) {
      known.set(id, row.version);
      try {
        return { kind: "stale", change: asChange(table, row) };
      } catch (error) {
        // A row this client cannot read is not a race and not a network wobble.
        // Retrying would be a loop that never ends, so it is reported as final.
        console.warn("board: could not read the row that won", error);
        return { kind: "denied" };
      }
    }
    return { kind: "denied" };
  };

  const writer: BoardWriter = {
    async write(change) {
      const supabase = getSupabase();
      const table = tableOf(change);

      if (change.kind === "entity/delete" || change.kind === "string/delete") {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq("id", change.id);
        if (error) return classify(error);
        known.delete(change.id);
        return { kind: "ok" };
      }

      const row =
        change.kind === "entity/upsert"
          ? entityToRow(change.entity, boardId)
          : stringToRow(change.string, boardId);
      const base = known.get(row.id);

      if (base === undefined) {
        const { data, error } = await supabase
          .from(table)
          .insert({ ...row, created_by: userId })
          .select();
        if (error) {
          // A retry of an insert that already landed is not a failure.
          if (isDuplicate(error)) {
            const seen = (await readRow(table, row.id)) as {
              version?: number;
            } | null;
            if (seen && typeof seen.version === "number") {
              known.set(row.id, seen.version);
              return { kind: "ok", version: seen.version };
            }
          }
          return classify(error);
        }
        const version = (data?.[0] as { version?: number } | undefined)
          ?.version;
        if (typeof version === "number") known.set(row.id, version);
        return version === undefined ? { kind: "ok" } : { kind: "ok", version };
      }

      const { data, error } = await supabase
        .from(table)
        .update(row)
        .eq("id", row.id)
        .eq("version", base)
        .select();
      if (error) return classify(error);

      if (data && data.length > 0) {
        const version = (data[0] as { version?: number }).version;
        if (typeof version === "number") known.set(row.id, version);
        return version === undefined ? { kind: "ok" } : { kind: "ok", version };
      }
      return discriminate(table, row.id, base);
    },
  };

  const outbox = createOutbox({
    writer,
    apply: (change) => {
      if (!disposed) emit(change);
    },
    outcome: (outcome) => {
      if (!disposed) tell(outcome);
    },
  });

  const catchUp = async (): Promise<void> => {
    const state = await loadBoard(boardId, { since: lastSeen });
    if (disposed || !state) return;
    lastSeen = Date.now();

    // Items before strings: a string names two of them.
    for (const entity of state.entities) {
      known.set(entity.id, entity.version);
      emit({ kind: "entity/upsert", entity });
    }
    for (const link of state.strings) {
      known.set(link.id, link.version);
      emit({ kind: "string/upsert", string: link });
    }
  };

  const onRow = (table: Table, payload: PgPayload): void => {
    if (disposed) return;

    if (payload.eventType === "DELETE") {
      // `payload.old` is the primary key and nothing else under RLS.
      const id = (payload.old as { id?: string } | null)?.id;
      if (!id) return;
      known.delete(id);
      emit(
        table === "items"
          ? { kind: "entity/delete", id }
          : { kind: "string/delete", id },
      );
      return;
    }

    try {
      const plain = payload.new as { id?: string; version?: number };
      if (plain?.id && typeof plain.version === "number") {
        known.set(plain.id, plain.version);
        // Our own write coming back. Reporting where the server last heard from us
        // would drag the thing back a round trip, so a drag would fight itself.
        if (outbox.isOwn(plain.id, plain.version)) return;
      }
      emit(asChange(table, payload.new));
    } catch (error) {
      // A row this client cannot read is not a reason to lose the connection.
      console.warn("board: could not read a change", error);
    }
  };

  const open = (): void => {
    if (disposed) return;
    setStatus("connecting");
    try {
      channel = getSupabase()
        .channel(`board:${boardId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "items",
            filter: `board_id=eq.${boardId}`,
          },
          (payload) => onRow("items", payload as unknown as PgPayload),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "strings",
            filter: `board_id=eq.${boardId}`,
          },
          (payload) => onRow("strings", payload as unknown as PgPayload),
        )
        .subscribe((state) => {
          if (disposed) return;
          if (state === "SUBSCRIBED") {
            setStatus("live");
            // Everything missed while away, including the first load after joining.
            void catchUp();
          } else {
            setStatus("connecting");
          }
        });
    } catch (error) {
      console.warn("board: could not open a channel", error);
      setStatus("offline");
    }
  };

  open();

  return {
    publish(change): PublishResult {
      if (disposed) return "local";
      outbox.send(change);
      return "sent";
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onOutcome(listener) {
      outcomes.add(listener);
      return () => outcomes.delete(listener);
    },
    resync() {
      void catchUp();
    },
    status: () => status,
    onStatus(listener) {
      watchers.add(listener);
      return () => watchers.delete(listener);
    },
    dispose() {
      disposed = true;
      outbox.dispose();
      void channel?.unsubscribe();
      channel = null;
      status = "offline";
    },
  };
}
