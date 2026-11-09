// The free Supabase tier pauses a project nobody has used for a while. The
// Worker can tell, and can wake it; this asks it once on load and, when the
// server is down, takes over the page until it is back.

import { useCallback, useEffect, useState } from "react";

export type ServerState = "up" | "asleep" | "waking" | "unavailable";

export interface ServerStatus {
  state: ServerState;
  canStart: boolean;
}

export const STATUS_URL = "/api/supabase/status";
export const START_URL = "/api/supabase/start";
const POLL_MS = 5000;

/**
 * Null while asking, and for good when there is no Worker to ask: the dev server
 * and the GitHub Pages build answer with HTML or a 404, and the app carries on.
 */
export async function fetchServerStatus(
  fetcher: typeof fetch = fetch,
): Promise<ServerStatus | null> {
  try {
    const response = await fetcher(STATUS_URL, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<ServerStatus>;
    const states: ServerState[] = ["up", "asleep", "waking", "unavailable"];
    if (!states.includes(body.state as ServerState)) return null;
    return {
      state: body.state as ServerState,
      canStart: body.canStart === true,
    };
  } catch {
    return null;
  }
}

export function useServerStatus(enabled: boolean): ServerStatus | null {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void fetchServerStatus().then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return status;
}

export interface ServerAsleepProps {
  initial: ServerStatus;
  fetcher?: typeof fetch;
  /** What happens once the server is back. A reload, so nothing cached the outage. */
  onUp?: () => void;
  pollMs?: number;
}

export function ServerAsleep({
  initial,
  fetcher = fetch,
  onUp = () => window.location.reload(),
  pollMs = POLL_MS,
}: ServerAsleepProps) {
  const [status, setStatus] = useState(initial);
  const [failed, setFailed] = useState(false);

  const check = useCallback(async () => {
    const next = await fetchServerStatus(fetcher);
    if (next) setStatus(next);
  }, [fetcher]);

  useEffect(() => {
    if (status.state === "up") onUp();
  }, [status.state, onUp]);

  useEffect(() => {
    if (status.state !== "waking") return;
    const timer = window.setInterval(() => void check(), pollMs);
    return () => window.clearInterval(timer);
  }, [status.state, check, pollMs]);

  const start = async (): Promise<void> => {
    setFailed(false);
    setStatus((from) => ({ ...from, state: "waking" }));
    try {
      const response = await fetcher(START_URL, { method: "POST" });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { state?: ServerState };
      if (body.state) setStatus((from) => ({ ...from, state: body.state! }));
    } catch {
      setFailed(true);
      setStatus((from) => ({ ...from, state: "asleep" }));
    }
  };

  const button =
    "rounded border border-accent px-3 py-1 text-[13px] text-board-ink transition hover:bg-accent/10 disabled:opacity-50";

  return (
    <div className="app-shell flex h-screen items-center justify-center p-6">
      <div
        className="flex max-w-sm flex-col items-start gap-3 rounded border border-border/30 bg-cork-900/55 px-5 py-4"
        data-testid="server-asleep"
      >
        {status.state === "waking" ? (
          <>
            <h1 className="text-base text-board-ink">Starting the server…</h1>
            <p className="text-sm text-board-ink-soft" role="status">
              This takes a minute or two. The page reloads when it is ready.
            </p>
          </>
        ) : status.state === "asleep" ? (
          <>
            <h1 className="text-base text-board-ink">The server is asleep</h1>
            <p className="text-sm text-board-ink-soft">
              It pauses after a stretch without visitors.
            </p>
            {status.canStart ? (
              <button
                type="button"
                className={button}
                data-testid="start-server"
                onClick={() => void start()}
              >
                Start
              </button>
            ) : (
              <p className="text-sm text-board-ink-soft">
                Ask the owner to restore it from the Supabase dashboard.
              </p>
            )}
            {failed ? (
              <p className="text-sm text-board-ink" role="alert">
                It could not be started. Try again in a moment.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <h1 className="text-base text-board-ink">
              The server can’t be reached
            </h1>
            <button
              type="button"
              className={button}
              onClick={() => void check()}
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
