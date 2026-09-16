/**
 * The bundle, compiled into the app.
 *
 * `telamon` takes an in-memory `Record<path, contents>` and has no opinion on
 * where it came from, so loading is the app's choice. Vite's `import.meta.glob`
 * with `eager` reads every markdown file at build time and inlines it, which
 * is what makes this a single-artifact SPA: there is no server to ask, and
 * nothing to fetch after the JavaScript arrives.
 *
 * The cost is the obvious one -- the whole corpus ships to every visitor
 * before the first document renders -- and it is the right trade exactly when
 * the corpus is small and you would rather deploy a directory than a process.
 */
const modules = import.meta.glob('../bundle/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const PREFIX = '../bundle/';

/** Glob keys are relative to this file; OKF paths are relative to the bundle root. */
export const BUNDLE: Record<string, string> = Object.fromEntries(
  Object.entries(modules).map(([path, contents]) => [path.slice(PREFIX.length), contents]),
);
