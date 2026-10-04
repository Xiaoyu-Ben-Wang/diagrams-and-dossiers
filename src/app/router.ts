/**
 * A router for two routes.
 *
 * The board and the wiki are separate pages, not two modes of one page — `/wiki`
 * is a real URL you can bookmark, link to, and reload into. That matters for a
 * wiki specifically: half the point of a wiki is that a page about a thing has
 * an address you can paste into chat.
 *
 * Hand-rolled rather than pulling in a router library. Two routes with no nested
 * layouts, no loaders, and no params beyond one optional slug do not justify a
 * dependency; this is about forty lines and it is testable. If the app grows
 * routes with real nesting, replacing this is an afternoon.
 *
 * `pushState` does not fire `popstate`, so navigation also dispatches a custom
 * event. Without it the app would not re-render on an in-app link, only on the
 * back button.
 */

import { useCallback, useSyncExternalStore } from 'react'

export type Route =
  | { name: 'board' }
  | { name: 'wiki'; slug: string | null }
  | { name: 'notFound'; path: string }

/** Fired after `pushState`/`replaceState`, which the browser does not announce. */
export const ROUTE_CHANGE_EVENT = 'case-board:route-change'

/** Parse a pathname into a route. Pure, so the mapping is testable on its own. */
export function parseRoute(pathname: string): Route {
  // Trailing slashes are the same page. So is an empty path.
  const path = normalizePath(pathname)

  if (path === '/') return { name: 'board' }

  if (path === '/wiki') return { name: 'wiki', slug: null }

  if (path.startsWith('/wiki/')) {
    const slug = path.slice('/wiki/'.length)
    if (slug.length > 0) return { name: 'wiki', slug: decodeURIComponent(slug) }
  }

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
    case 'wiki':
      return route.slug ? `/wiki/${encodeURIComponent(route.slug)}` : '/wiki'
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
