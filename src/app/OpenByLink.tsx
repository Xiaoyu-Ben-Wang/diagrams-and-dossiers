// Someone opened /b/<id> for a board this browser does not have. If the board is
// shared, the server lets them in and it joins their list; if it is private or
// does not exist, they are told so.

import { useEffect, useState } from "react";

import { loadIdentity } from "../identity/identity";
import { openSharedBoard } from "../boards/remote";
import type { BoardLibrary } from "../boards/library";
import { loadBoard } from "../realtime/load";
import { ensureSession } from "../supabase/session";

export interface OpenByLinkProps {
  boardId: string;
  library: BoardLibrary;
  onHome: () => void;
}

export function OpenByLink({ boardId, library, onHome }: OpenByLinkProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);

    void (async () => {
      const session = await ensureSession();
      if (!session) return void (live && setFailed(true));

      const identity = loadIdentity();
      const name = identity.anonymous ? null : (identity.displayName ?? null);
      const opened = await openSharedBoard(boardId, name);
      if (!opened) return void (live && setFailed(true));

      const board = await loadBoard(opened.boardId);
      if (!board) return void (live && setFailed(true));

      // Once it is in the library the app resolves the route and opens it.
      if (live && !library.get().some((each) => each.id === opened.boardId))
        await library.create(opened.name, board, {
          id: opened.boardId,
          owned: opened.role === "owner",
        });
    })();

    return () => {
      live = false;
    };
  }, [boardId, library]);

  return (
    <div className="app-shell flex h-screen items-center justify-center p-6">
      <div
        className="flex max-w-sm flex-col items-start gap-3 rounded border border-border/30 bg-cork-900/55 px-5 py-4"
        data-testid="open-by-link"
      >
        {failed ? (
          <>
            <p className="text-sm text-board-ink" role="alert">
              This board is private, or the link is wrong.
            </p>
            <button
              type="button"
              onClick={onHome}
              className="rounded border border-border/25 px-2.5 py-1 text-[13px] text-board-ink-soft transition hover:border-accent hover:text-board-ink"
            >
              Your boards
            </button>
          </>
        ) : (
          <p className="text-sm text-board-ink-soft" role="status">
            Opening the board…
          </p>
        )}
      </div>
    </div>
  );
}
