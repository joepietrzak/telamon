import { useCallback, useSyncExternalStore } from 'react';
import { normalizeRoute } from '../bundle/paths.js';
import { splitRoute, type NavigateOptions, type RouterAdapter } from './types.js';

export interface MemoryRouter extends RouterAdapter {
  /** Every route visited, oldest first. */
  readonly entries: readonly string[];
  /** Current route, readable outside React. */
  readonly current: string;
}

/**
 * An in-memory router with no browser dependency. Backs the test suite and
 * server rendering, where there is no location to read or push to.
 */
export function createMemoryRouter(initialRoute = '/'): MemoryRouter {
  const listeners = new Set<() => void>();
  const entries: string[] = [];
  let current = '';
  let fragment = '';

  const set = (route: string, replace: boolean) => {
    const target = splitRoute(route);
    current = normalizeRoute(target.path);
    fragment = target.fragment ?? '';
    if (replace && entries.length > 0) entries[entries.length - 1] = current;
    else entries.push(current);
    for (const listener of listeners) listener();
  };

  set(initialRoute, false);

  const subscribe = (onStoreChange: () => void) => {
    listeners.add(onStoreChange);
    return () => listeners.delete(onStoreChange);
  };

  return {
    get entries() {
      return entries;
    },
    get current() {
      return current;
    },
    usePath() {
      return useSyncExternalStore(
        subscribe,
        () => current,
        useCallback(() => current, []),
      );
    },
    useFragment() {
      return useSyncExternalStore(
        subscribe,
        () => fragment,
        useCallback(() => fragment, []),
      );
    },
    navigate(route: string, options: NavigateOptions = {}) {
      set(route, options.replace ?? false);
    },
    createHref(route: string) {
      const { path, fragment: hash } = splitRoute(route);
      const normalized = normalizeRoute(path);
      return hash ? `${normalized}#${hash}` : normalized;
    },
  };
}
