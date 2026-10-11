import { useCallback, useSyncExternalStore } from "react";

export type Route =
  | {
      name: "board";
      /** Null at `/`, which opens whichever board was last open. */ id:
        string | null;
    }
  | { name: "library" }
  /** The sample board, rendered from the seed and belonging to no library. */
  | { name: "demo" }
  /**
   * A board link, carrying an edit token. Redeemed once and then replaced — §1's
   * token is a door, not a credential, so it does not stay in the address bar.
   */
  | { name: "join"; token: string }
  /** A creator invite, which is the one thing that grants the right to make a board. */
  | { name: "invite"; token: string }
  | { name: "notFound"; path: string };

/** pushState fires no popstate; this event is how the app hears its own navigation. */
export const ROUTE_CHANGE_EVENT = "case-board:route-change";

export function parseRoute(pathname: string): Route {
  const path = normalizePath(pathname);

  if (path === "/") return { name: "board", id: null };
  if (path === "/boards") return { name: "library" };
  if (path === "/demo") return { name: "demo" };

  const board = /^\/b\/([^/]+)$/.exec(path);
  if (board) return { name: "board", id: decodeURIComponent(board[1]) };

  const join = /^\/j\/([^/]+)$/.exec(path);
  if (join) return { name: "join", token: decodeURIComponent(join[1]) };

  const invite = /^\/c\/([^/]+)$/.exec(path);
  if (invite) return { name: "invite", token: decodeURIComponent(invite[1]) };

  return { name: "notFound", path };
}

/** Vite's BASE_URL: "/" in dev, the deploy subpath (e.g. /diagrams-and-dossiers/) on GitHub Pages. */
export const BASE_PATH = normalizePath(import.meta.env.BASE_URL || "/");

export function withBase(path: string, base: string = BASE_PATH): string {
  if (base === "/") return path;
  return path === "/" ? `${base}/` : `${base}${path}`;
}

export function withoutBase(path: string, base: string = BASE_PATH): string {
  if (base === "/") return path;
  if (path === base) return "/";
  return path.startsWith(`${base}/`) ? path.slice(base.length) : path;
}

export function normalizePath(pathname: string): string {
  if (!pathname) return "/";
  let path = pathname;
  if (!path.startsWith("/")) path = `/${path}`;
  while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

export function routeToPath(route: Route): string {
  switch (route.name) {
    case "board":
      return route.id === null ? "/" : `/b/${encodeURIComponent(route.id)}`;
    case "library":
      return "/boards";
    case "demo":
      return "/demo";
    case "join":
      return `/j/${encodeURIComponent(route.token)}`;
    case "invite":
      return `/c/${encodeURIComponent(route.token)}`;
    case "notFound":
      return route.path;
  }
}

/**
 * Where `public/404.html` parks the path GitHub Pages could not serve. Must match
 * the literal in that file, which cannot read `import.meta.env` (Vite copies
 * `public/` verbatim).
 */
export const DEEP_LINK_KEY = "case-board:deep-link";

/**
 * Puts back the path the 404 boot page stashed, before anything reads the
 * location. Pages has no rewrite, so this is the only way a pasted
 * `/diagrams-and-dossiers/b/<id>` reaches the router at all.
 */
export function restoreDeepLink(storage?: Storage): void {
  try {
    const store = storage ?? globalThis.sessionStorage;
    const path = store?.getItem(DEEP_LINK_KEY);
    if (!path || !path.startsWith("/")) return;
    store?.removeItem(DEEP_LINK_KEY);
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", path);
  } catch {
    // Private windows block sessionStorage; `/` and the last-open board remain.
  }
}

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return withoutBase(normalizePath(window.location.pathname));
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("popstate", onChange);
  window.addEventListener(ROUTE_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(ROUTE_CHANGE_EVENT, onChange);
  };
}

export interface UseRouteResult {
  route: Route;
  path: string;
  navigate: (to: Route | string, options?: { replace?: boolean }) => void;
}

export function useRoute(): UseRouteResult {
  const path = useSyncExternalStore(subscribe, currentPath, () => "/");

  const navigate = useCallback(
    (to: Route | string, options?: { replace?: boolean }) => {
      const next = normalizePath(typeof to === "string" ? to : routeToPath(to));
      if (typeof window === "undefined") return;
      if (next === currentPath()) return;

      if (options?.replace)
        window.history.replaceState(null, "", withBase(next));
      else window.history.pushState(null, "", withBase(next));

      window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
    },
    [],
  );

  return { route: parseRoute(path), path, navigate };
}
