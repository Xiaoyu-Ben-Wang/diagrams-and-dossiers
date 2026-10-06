import { useCallback, useSyncExternalStore } from "react";

export type Route = { name: "board" } | { name: "notFound"; path: string };

/** pushState fires no popstate; this event is how the app hears its own navigation. */
export const ROUTE_CHANGE_EVENT = "case-board:route-change";

export function parseRoute(pathname: string): Route {
  const path = normalizePath(pathname);

  if (path === "/") return { name: "board" };

  return { name: "notFound", path };
}

/** Vite's BASE_URL: "/" in dev, the deploy subpath (e.g. /dossiers-and-diagrams/) on GitHub Pages. */
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
      return "/";
    case "notFound":
      return route.path;
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
