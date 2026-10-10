// The shell: which screen, and which board. Everything the board itself does —
// the canvas, the editors, the camera — lives in `board/BoardScreen`.

import { useCallback, useEffect, useMemo, useState } from "react";

import { ARTICLE_TITLE, demoBoard } from "./app/demo";
import { EntryScreen } from "./app/JoinScreen";
import { NotFound } from "./app/NotFound";
import { useRoute } from "./app/router";
import { newBoardOnServer } from "./boards/new-board";
import { supabaseSync } from "./realtime/supabase-sync";
import type { BoardSync } from "./realtime/transport";
import { ensureSession } from "./supabase/session";
import { BoardScreen } from "./board/BoardScreen";
import type { BoardState } from "./board/store";
import type { BoardRecord } from "./boards/board-record";
import { getBoardStorage, type BoardStorage } from "./boards/board-storage";
import { createBoardLibrary, useLibrary } from "./boards/library";
import { loadLastOpenId, saveLastOpenId } from "./boards/last-open";
import { LibraryScreen } from "./boards/LibraryScreen";

export interface AppProps {
  /** Opens this document with no library behind it, which is what the tests want. */
  seed?: BoardState;
  storage?: BoardStorage;
  now?: () => number;
}

export function App({ seed, storage, now }: AppProps = {}) {
  const { route, navigate } = useRoute();
  const backing = useMemo(() => storage ?? getBoardStorage(), [storage]);
  const library = useMemo(
    () => createBoardLibrary(backing, { now }),
    [backing, now],
  );
  const records = useLibrary(library);

  useEffect(() => {
    if (!library.ready()) void library.refresh();
  }, [library]);

  // `/` names no board, so it opens the one you had, or the one you touched last.
  const wantId = route.name === "board" ? route.id : null;
  const resolved =
    wantId === null
      ? null
      : (records.find((each) => each.id === wantId) ?? null);
  const unresolved = route.name === "board" && wantId === null;

  useEffect(() => {
    if (seed || !unresolved || !library.ready()) return;
    const last = loadLastOpenId();
    const target =
      (last && records.some((each) => each.id === last)
        ? last
        : records[0]?.id) ?? null;
    // The library is the honest landing place when there is nothing to open.
    navigate(
      target === null ? { name: "library" } : { name: "board", id: target },
      { replace: true },
    );
  }, [seed, unresolved, library, records, navigate]);

  useEffect(() => {
    if (resolved) saveLastOpenId(resolved.id);
  }, [resolved?.id]);

  // A board on the server needs a socket, and a socket needs a session, which is
  // an anonymous sign-in. So the screen waits for the transport rather than
  // rendering a board that would quietly be local.
  //
  // `pending` is the *initial* state, and that is the whole point: the store takes
  // its transport when it is built and never looks again, so mounting the screen
  // while the answer is still unknown bakes `localSync()` into it for good. The
  // answer arrives in an effect, and React may batch that straight to the final
  // value — so a gate that waits to be *told* it is pending never sees it, and the
  // board silently drops every edit on the floor.
  const isRemote = resolved?.remote === true;
  const [transport, setTransport] = useState<
    "pending" | "local" | BoardSync
  >("pending");
  const [userId, setUserId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!resolved) {
      setTransport("pending");
      return;
    }
    let live = true;
    let built: BoardSync | null = null;

    if (resolved.remote !== true) {
      setTransport("local");
      return;
    }

    setTransport("pending");
    void ensureSession().then((session) => {
      if (!live) return;
      if (!session) {
        // No session means no socket. The board still opens, from what is here.
        setTransport("local");
        return;
      }
      setUserId(session.userId);
      built = supabaseSync({
        boardId: resolved.id,
        userId: session.userId,
        initial: resolved.board,
      });
      setTransport(built);
    });

    return () => {
      live = false;
      built?.dispose();
    };
    // Keyed on the board, not the record: a records refresh must not rebuild the
    // socket, and `initial` is only ever read once, to seed what is known.
  }, [resolved?.id, resolved?.remote]);

  const openBoard = useCallback(
    (id: string) => navigate({ name: "board", id }),
    [navigate],
  );

  const createBoard = useCallback(async () => {
    // On the server first, so a board that can be shared gets a link from the
    // start. `null` means it could not be — no invite, no session, no network —
    // and the board stays on this machine rather than not existing at all.
    const remote = await newBoardOnServer("Untitled board");
    const record = await library.create(
      "Untitled board",
      undefined,
      remote ?? undefined,
    );
    openBoard(record.id);
  }, [library, openBoard]);

  // `/demo` rather than a copy of it: the sample board is a look at a finished
  // board, and it belongs in the library only if somebody asks for it to.
  const openDemo = useCallback(() => {
    navigate({ name: "demo" });
  }, [navigate]);

  const addBoard = useCallback(
    async (name: string, board: BoardState) => {
      const record = await library.create(name, board);
      openBoard(record.id);
    },
    [library, openBoard],
  );

  const saveCurrent = useCallback(
    (board: BoardState) => {
      if (resolved) return library.saveDocument(resolved.id, board);
    },
    [library, resolved],
  );

  // `replace`, so the token leaves the address bar and the history with it.
  const finishEntry = useCallback(
    (boardId: string | null) => {
      if (boardId) navigate({ name: "board", id: boardId }, { replace: true });
      else navigate({ name: "library" }, { replace: true });
    },
    [navigate],
  );

  if (seed) return <BoardScreen board={seed} />;

  if (route.name === "join" || route.name === "invite") {
    return (
      <EntryScreen
        kind={route.name}
        token={route.token}
        library={library}
        onDone={finishEntry}
      />
    );
  }

  // No `onSave`: the demo is a look at a finished board, not a document. Leaving
  // it saved nothing, and there is no library record to open it again by.
  if (route.name === "demo") {
    return (
      <BoardScreen
        key="demo"
        board={demoBoard()}
        name={ARTICLE_TITLE}
        // Its own key: the demo has no id, and should still open where it was left.
        viewId="demo"
        onBack={() => navigate({ name: "library" })}
      />
    );
  }

  if (route.name === "notFound") {
    return (
      <NotFound
        path={route.path}
        onHome={() => navigate({ name: "library" })}
      />
    );
  }

  if (route.name === "library") {
    return (
      <LibraryScreen
        library={library}
        records={records}
        onOpen={openBoard}
        onCreate={() => void createBoard()}
        onOpenDemo={() => void openDemo()}
      />
    );
  }

  if (!resolved) return <Opening ready={library.ready()} />;

  if (transport === "pending") return <Opening ready={library.ready()} />;

  return (
    <BoardScreen
      // Keyed by id: a different board is a different screen, so the camera,
      // the selection and the opening fit all start over rather than carry across.
      key={resolved.id}
      board={resolved.board}
      name={resolved.name}
      onRename={(next) => void library.rename(resolved.id, next)}
      viewId={resolved.id}
      onBack={() => navigate({ name: "library" })}
      onSave={saveCurrent}
      onAddBoard={addBoard}
      sync={transport === "local" ? undefined : transport}
      // Whoever holds a link may edit it — permissions are the server's business,
      // and `editor` is everything the client checks for short of ownership.
      viewer={isRemote ? { role: "editor", userId } : undefined}
    />
  );
}

/** Shown while the library is still being read, and for the instant before `/` resolves. */
function Opening({ ready }: { ready: boolean }) {
  return (
    <div className="app-shell flex h-screen items-center justify-center">
      <p
        className="rounded border border-parchment-edge/30 bg-cork-900/55 px-5 py-4 text-sm text-board-ink-soft"
        role="status"
      >
        {ready ? "Looking for your board…" : "Opening your boards…"}
      </p>
    </div>
  );
}

export type { BoardRecord };
