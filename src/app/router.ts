/**
 * The board's address.
 *
 * One real route today — the board at `/` — plus the catch-all that every URL
 * bar needs. Keeping the URL honest is what lets the back button work and a
 * reload land where you were, and it is the seam a second page would slot into.
 *
 * Hand-rolled rather than pulling in a router library: one route with no nested
 * layouts, no loaders and no params does not justify a dependency, and this is
 * testable on its own. If the app grows routes with real nesting, replacing it
 * is an afternoon.
 *
 * `pushState` does not fire `popstate`, so navigation also dispatches a custom
 * event. Without it the app would not re-render on an in-app link, only on the
 * back button.
 */

import { useCallback, useSyncExternalStore } from 'react'

export type Route = { name: 'board' } | { name: 'notFound'; path: string }

/** Fired after `pushState`/`replaceState`, which the browser does not announce. */
export const ROUTE_CHANGE_EVENT = 'case-board:route-change'

/** Parse a pathname into a route. Pure, so the mapping is testable on its own. */
export function parseRoute(pathname: string): Route {
  // Trailing slashes are the same page. So is an empty path.
  const path = normalizePath(pathname)

  if (path === '/') return { name: 'board' }

  return { name: 'notFound', path }
}

/** Collapse a pathname to its canonical form: leading slash, no trailing slash. */
export function normalizePath(pathname: string): string {
  if (!pathname) return '/'
  let path = pathname
  if (!path.startsWith('/')) path = `/${path}`
  // Collapse a trailing slash, but never turn "/" into "".
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path
}

/** The canonical URL for a route. Inverse of `parseRoute` for known routes. */
export function routeToPath(route: Route): string {
  switch (route.name) {
    case 'board':
      return '/'
    case 'notFound':
      return route.path
  }
}

function currentPath(): string {
  if (typeof window === 'undefined') return '/'
  return normalizePath(window.location.pathname)
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  window.addEventListener('popstate', onChange)
  window.addEventListener(ROUTE_CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(ROUTE_CHANGE_EVENT, onChange)
  }
}

export interface UseRouteResult {
  route: Route
  path: string
  navigate: (to: Route | string, options?: { replace?: boolean }) => void
}

export function useRoute(): UseRouteResult {
  // useSyncExternalStore rather than useState + effect: the URL is genuinely
  // external state, and this keeps the render consistent with it even if
  // something navigates between the effect running and the first paint.
  const path = useSyncExternalStore(subscribe, currentPath, () => '/')

  const navigate = useCallback((to: Route | string, options?: { replace?: boolean }) => {
    const next = normalizePath(typeof to === 'string' ? to : routeToPath(to))
    if (typeof window === 'undefined') return
    if (next === currentPath()) return

    if (options?.replace) window.history.replaceState(null, '', next)
    else window.history.pushState(null, '', next)

    window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT))
  }, [])

  return { route: parseRoute(path), path, navigate }
}
