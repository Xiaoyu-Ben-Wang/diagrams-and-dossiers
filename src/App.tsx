// The shell: which screen, and which board. Everything the board itself does —
// the canvas, the editors, the camera — lives in `board/BoardScreen`.

import { useCallback, useEffect, useMemo } from "react";

import { demoBoard } from "./app/demo";
import { NotFound } from "./app/NotFound";
import { useRoute } from "./app/router";
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

  const openBoard = useCallback(
    (id: string) => navigate({ name: "board", id }),
    [navigate],
  );

  const createBoard = useCallback(async () => {
    const record = await library.create("Untitled board");
    openBoard(record.id);
  }, [library, openBoard]);

  const openDemo = useCallback(async () => {
    const record = await library.create("The Drowned Bell", demoBoard());
    openBoard(record.id);
  }, [library, openBoard]);

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

  if (seed) return <BoardScreen board={seed} />;

  // No `onSave`: the demo is a look at a finished board, not a document. Leaving
  // it saved nothing, and there is no library record to open it again by.
  if (route.name === "demo") {
    return (
      <BoardScreen
        key="demo"
        board={demoBoard()}
        name="The Drowned Bell"
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

  return (
    <BoardScreen
      // Keyed by id: a different board is a different screen, so the camera,
      // the selection and the opening fit all start over rather than carry across.
      key={resolved.id}
      board={resolved.board}
      name={resolved.name}
      viewId={resolved.id}
      onBack={() => navigate({ name: "library" })}
      onSave={saveCurrent}
      onAddBoard={addBoard}
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
