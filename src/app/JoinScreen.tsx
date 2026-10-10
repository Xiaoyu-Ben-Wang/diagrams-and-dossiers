// The door: a board link, or a creator invite.
//
// The token is redeemed once and then dropped from the address bar — §1's "a door,
// not a credential". Nothing here is reached without a project behind it, which is
// why the whole screen answers a single failure rather than pretending.
import { useCallback, useEffect, useState } from "react";

import { anonymousName } from "../identity/creature-names";
import { loadIdentity, saveIdentity, type Identity } from "../identity/identity";
import { boardName, joinBoard, redeemCreatorInvite } from "../boards/remote";
import type { BoardLibrary } from "../boards/library";
import { loadBoard } from "../realtime/load";
import { ensureSession } from "../supabase/session";
import "./JoinScreen.css";

export type EntryKind = "join" | "invite";

export interface EntryScreenProps {
  kind: EntryKind;
  token: string;
  library: BoardLibrary;
  /** The board to open, or null when there is nothing to open — an invite. */
  onDone: (boardId: string | null) => void;
}

type Stage = "naming" | "working" | "failed";

export function EntryScreen({ kind, token, library, onDone }: EntryScreenProps) {
  const [userId, setUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [anonymous, setAnonymous] = useState(() => loadIdentity().anonymous);
  const [stage, setStage] = useState<Stage>("naming");

  useEffect(() => {
    let live = true;
    void ensureSession().then((session) => {
      if (!live) return;
      if (!session) {
        setStage("failed");
        return;
      }
      const stored = loadIdentity();
      setUserId(session.userId);
      setAnonymous(stored.anonymous);
      setDraft(stored.displayName ?? "");
    });
    return () => {
      live = false;
    };
  }, []);

  /** What everyone else will see: the chosen name, or the creature derived from the id. */
  const shown =
    anonymous || draft.trim() === ""
      ? userId
        ? anonymousName(userId)
        : "…"
      : draft.trim();

  const submit = useCallback(async () => {
    setStage("working");
    const identity: Identity = anonymous
      ? { anonymous: true }
      : { displayName: draft.trim() || undefined, anonymous: false };
    saveIdentity(identity);

    const name = identity.anonymous ? null : (identity.displayName ?? null);

    if (kind === "invite") {
      if (!(await redeemCreatorInvite(token, name ?? ""))) {
        setStage("failed");
        return;
      }
      onDone(null);
      return;
    }

    const joined = await joinBoard(token, name);
    if (!joined) {
      setStage("failed");
      return;
    }

    const board = await loadBoard(joined.boardId);
    if (!board) {
      setStage("failed");
      return;
    }

    const known = library.get().find((each) => each.id === joined.boardId);
    if (!known) {
      const title = (await boardName(joined.boardId)) ?? "A shared board";
      // No tokens: this person arrived by a link and does not hold one.
      await library.create(title, board, { id: joined.boardId });
    }
    onDone(joined.boardId);
  }, [anonymous, draft, kind, library, onDone, token]);

  return (
    <div className="app-shell flex h-screen items-center justify-center p-6">
      <form
        className="not-found flex w-full max-w-sm flex-col items-start gap-3 rounded border border-parchment-edge/30 bg-cork-900/55 px-5 py-4"
        data-testid="entry-screen"
        onSubmit={(event) => {
          event.preventDefault();
          if (stage === "naming") void submit();
        }}
      >
        <h1 className="text-sm font-semibold text-board-ink">
          {kind === "invite" ? "You have been invited" : "Join this board"}
        </h1>

        {stage === "failed" ? (
          <p className="text-xs text-board-ink-soft" data-testid="entry-failed">
            {kind === "invite"
              ? "That invite could not be redeemed. It may have been revoked, or already used."
              : "That link could not be opened. It may have been rotated, or the board may be gone."}
          </p>
        ) : null}

        {stage !== "failed" ? (
          <>
            <label className="flex w-full flex-col gap-1 text-xs text-board-ink-soft">
              What should people call you?
              <input
                className="library-rename"
                value={anonymous ? shown : draft}
                disabled={anonymous}
                placeholder={shown}
                aria-label="Your name on this board"
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-board-ink-soft">
              <input
                type="checkbox"
                checked={anonymous}
                aria-label="Stay anonymous"
                onChange={(event) => setAnonymous(event.target.checked)}
              />
              Stay anonymous — you will be {shown}
            </label>

            <button
              type="submit"
              disabled={stage === "working" || userId === null}
              className="entry-submit"
            >
              {stage === "working"
                ? "Working…"
                : kind === "invite"
                  ? "Redeem invite"
                  : "Join"}
            </button>
          </>
        ) : null}
      </form>
    </div>
  );
}
