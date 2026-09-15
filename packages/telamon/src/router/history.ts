import { useCallback, useSyncExternalStore } from 'react';
import { hrefToRoute, normalizeBasename, routeToHref } from '../bundle/paths.js';
import { splitRoute, type NavigateOptions, type RouterAdapter } from './types.js';

/** Dispatched on `window` after a programmatic navigation, since `pushState` fires nothing. */
const NAVIGATION_EVENT = 'okf:navigation';

export interface HistoryRouterOptions {
  /** Sub-path the site is mounted at, e.g. `/docs`. Defaults to the origin root. */
  basename?: string;
  /** Route reported during server rendering, before the browser location is readable. */
  serverRoute?: string;
}

/**
 * The default router: real URLs backed by the History API.
 *
 * The location is read through `useSyncExternalStore`, which gives correct
 * behaviour under concurrent rendering and a defined server snapshot, so a
 * site can be server-rendered without touching `window`.
 */
export function createHistoryRouter(options: HistoryRouterOptions = {}): RouterAdapter {
  const basename = normalizeBasename(options.basename);

  const readRoute = () => hrefToRoute(window.location.pathname, basename) ?? '/';
  /**
   * The route React renders against on the first pass -- the server render, and
   * the first render of a hydration, which must match it exactly.
   *
   * A server render supplies it. A hydrating client does not, and there the
   * browser's own location is the right answer: it is the URL the server just
   * rendered for. Defaulting to `/` instead silently mismatches every page but
   * the root, and React throws the server's HTML away and re-renders the lot.
   *
   * Read once here rather than inside the snapshot, because `window` exists
   * during a `renderToString` under jsdom too, and probing it at render time
   * would let a test environment hijack the server render.
   */
  const serverRoute =
    options.serverRoute ?? (typeof window === 'undefined' ? '/' : readRoute());

  const subscribe = (onStoreChange: () => void) => {
    window.addEventListener('popstate', onStoreChange);
    window.addEventListener('hashchange', onStoreChange);
    window.addEventListener(NAVIGATION_EVENT, onStoreChange);
    return () => {
      window.removeEventListener('popstate', onStoreChange);
      window.removeEventListener('hashchange', onStoreChange);
      window.removeEventListener(NAVIGATION_EVENT, onStoreChange);
    };
  };

  const readFragment = () => window.location.hash.replace(/^#/, '');


  const createHref = (route: string) => {
    const { path, fragment } = splitRoute(route);
    return routeToHref(path, basename, fragment);
  };

  return {
    usePath() {
      return useSyncExternalStore(
        subscribe,
        readRoute,
        useCallback(() => serverRoute, []),
      );
    },
    useFragment() {
      return useSyncExternalStore(
        subscribe,
        readFragment,
        useCallback(() => '', []),
      );
    },
    navigate(route: string, navigateOptions: NavigateOptions = {}) {
      const href = createHref(route);
      const method = navigateOptions.replace ? 'replaceState' : 'pushState';
      window.history[method](null, '', href);
      window.dispatchEvent(new Event(NAVIGATION_EVENT));
    },
    createHref,
  };
}
