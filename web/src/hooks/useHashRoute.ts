/**
 * `useHashRoute` — a tiny hash-based router for the Admin Panel SPA (Req 11.3,
 * 11.4).
 *
 * The panel switches between nine sections without a full page reload by
 * reading/writing `window.location.hash`. Because routing is hash-based, the
 * server's existing `/admin/*` static fallback already resolves deep links with
 * no server change (Req 11.4). No routing dependency is added — this keeps the
 * bundle lean (design: "Hash-based in-app router, no new dependency").
 *
 * See design.md → "Frontend → Navigation and routing".
 */
import { useCallback, useEffect, useState } from 'react';

/** The nine navigable sections of the Admin Panel (Req 11.2). */
export const ROUTES = [
  'dashboard',
  'users',
  'groups',
  'time-zones',
  'access-rules',
  'portals',
  'access-logs',
  'simulate',
  'interception',
] as const;

/** A valid route key, e.g. `'dashboard' | 'users' | …`. */
export type Route = (typeof ROUTES)[number];

/** The default route when the hash is empty or unknown (Req 11.3). */
export const DEFAULT_ROUTE: Route = 'dashboard';

/** Narrow an arbitrary string to a known {@link Route}, defaulting otherwise. */
function normalizeRoute(raw: string): Route {
  const value = raw.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(value)
    ? (value as Route)
    : DEFAULT_ROUTE;
}

/** Read the current route from `window.location.hash`. */
function readRoute(): Route {
  return normalizeRoute(window.location.hash);
}

/**
 * Subscribe to the URL hash and expose the current {@link Route} plus a setter
 * that navigates by updating the hash (which re-renders without a reload).
 */
export function useHashRoute(): readonly [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => readRoute());

  useEffect(() => {
    const onHashChange = (): void => {
      setRoute(readRoute());
    };
    window.addEventListener('hashchange', onHashChange);
    // Establish a canonical hash on first mount so the default route is visible.
    if (window.location.hash === '') {
      window.location.hash = `#/${DEFAULT_ROUTE}`;
    }
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const navigate = useCallback((next: Route): void => {
    window.location.hash = `#/${next}`;
  }, []);

  return [route, navigate] as const;
}
