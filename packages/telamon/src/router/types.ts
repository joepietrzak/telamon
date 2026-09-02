export interface NavigateOptions {
  replace?: boolean;
}

/**
 * The seam between the site and whatever owns the URL.
 *
 * Adapters speak in **routes** — basename-free, URL-decoded paths like
 * `/tables/events_`, optionally with a `#fragment`. Translating a route into a
 * real URL (basename, percent-encoding) is the adapter's job, which is what
 * lets the same site sit at the origin root, under a sub-path, or inside a host
 * application's own router.
 */
export interface RouterAdapter {
  /** React hook. Returns the current route. Must be safe to call every render. */
  usePath(): string;
  /** React hook. Returns the current `#fragment` without the hash, if the adapter tracks one. */
  useFragment?(): string;
  navigate(route: string, options?: NavigateOptions): void;
  createHref(route: string): string;
}

export interface RouteTarget {
  path: string;
  fragment?: string;
}

/** Split `/a/b#c` into its path and fragment halves. */
export function splitRoute(route: string): RouteTarget {
  const index = route.indexOf('#');
  if (index === -1) return { path: route };
  const path = route.slice(0, index);
  return { path: path === '' ? '/' : path, fragment: route.slice(index + 1) };
}
