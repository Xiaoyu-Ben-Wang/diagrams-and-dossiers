// Writing the board back as it changes.
//
// A subscriber rather than a hook inside the store: `store.ts` is a document with
// no notion of an id or of I/O. More usefully, `subscribe` does not fire when it
// is attached, and every mutator early-returns without emitting when nothing
// changed — so this sees exactly the changes, and cannot write over a board that
// has not finished loading.

import type { BoardState, BoardStore } from "../board/store";

export interface AutosaveOptions {
  store: Pick<BoardStore, "subscribe" | "get">;
  save: (board: BoardState) => void | Promise<void>;
  /** Quiet time after the last change. */
  delay?: number;
  /** Longest a change may sit unwritten, however continuous the writing is. */
  maxDelay?: number;
  target?: EventTarget;
}

export interface Autosave {
  flush(): Promise<void>;
  detach(): void;
}

const DEFAULT_DELAY = 400;
const DEFAULT_MAX_DELAY = 2000;

export function attachAutosave({
  store,
  save,
  delay = DEFAULT_DELAY,
  maxDelay = DEFAULT_MAX_DELAY,
  target = globalThis,
}: AutosaveOptions): Autosave {
  let dirtySince: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (dirtySince === null) return;
    dirtySince = null;
    // Read at flush time, not when the change was scheduled: a burst of typing
    // then writes the last state once rather than every state.
    await save(store.get());
  };

  const schedule = (): void => {
    const now = Date.now();
    if (dirtySince === null) dirtySince = now;
    if (timer !== null) clearTimeout(timer);
    // The ceiling is measured from the first unwritten change, so a long run of
    // typing still commits every `maxDelay` rather than never.
    const wait = Math.max(0, Math.min(delay, maxDelay - (now - dirtySince)));
    timer = setTimeout(() => {
      void flush();
    }, wait);
  };

  const unsubscribe = store.subscribe(schedule);

  const onPageHide = (): void => {
    void flush();
  };
  const onVisibility = (): void => {
    if (globalThis.document?.visibilityState === "hidden") void flush();
  };

  target.addEventListener?.("pagehide", onPageHide);
  globalThis.document?.addEventListener?.("visibilitychange", onVisibility);

  return {
    flush,
    detach() {
      unsubscribe();
      target.removeEventListener?.("pagehide", onPageHide);
      globalThis.document?.removeEventListener?.(
        "visibilitychange",
        onVisibility,
      );
      // Walking back to the library unmounts the board without unloading the
      // document, so this write completes where a page-close one might not.
      void flush();
    },
  };
}
