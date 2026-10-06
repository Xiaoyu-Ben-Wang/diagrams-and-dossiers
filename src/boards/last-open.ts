// Which board the app opens on. Kept in localStorage rather than IndexedDB
// because `/` needs it synchronously, at the first paint, before anything async
// has had a chance to answer.

export const LAST_OPEN_KEY = "detective-board.last-board";

export function loadLastOpenId(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const value = localStorage.getItem(LAST_OPEN_KEY);
    return value ? value : null;
  } catch {
    // Private windows and blocked cookies throw; `/` then falls back to the list.
    return null;
  }
}

export function saveLastOpenId(id: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (id === null) localStorage.removeItem(LAST_OPEN_KEY);
    else localStorage.setItem(LAST_OPEN_KEY, id);
  } catch {
    // Swallowed: which board opens next is a convenience, not the board itself.
  }
}
