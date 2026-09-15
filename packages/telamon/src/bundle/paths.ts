/**
 * Path and route arithmetic.
 *
 * Two vocabularies live here and must not be confused:
 *
 * - **File paths** are bundle-relative POSIX paths (`references/metrics/purchasers.md`).
 * - **Routes** are canonical, URL-*decoded* application paths (`/references/metrics/purchasers`).
 *   Percent-encoding is applied only when a route is turned into an href.
 */

const MD_EXT = /\.md$/i;

/** Collapse `.`/`..`/empty segments. Accepts absolute or relative input; output is relative. */
export function resolvePosix(fromDir: string, rel: string): string {
  const segments = `${fromDir}/${rel}`.replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

/** Normalize a bundle-relative file path: no leading slash, no `.`/`..`, forward slashes. */
export function normalizeFilePath(filePath: string): string {
  return resolvePosix('', filePath);
}

export function dirOf(filePath: string): string {
  const normalized = normalizeFilePath(filePath);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

export function baseNameOf(filePath: string): string {
  const normalized = normalizeFilePath(filePath);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

/** File stem without the `.md` extension. */
export function stemOf(filePath: string): string {
  return baseNameOf(filePath).replace(MD_EXT, '');
}

export function isMarkdownPath(filePath: string): boolean {
  return MD_EXT.test(filePath);
}

/** Reserved filenames carry no frontmatter and render differently (SPEC §3.1). */
export function reservedKindOf(filePath: string): 'index' | 'log' | null {
  const base = baseNameOf(filePath).toLowerCase();
  if (base === 'index.md') return 'index';
  if (base === 'log.md') return 'log';
  return null;
}

/** `/`, with no trailing slash and no duplicate slashes. */
export function normalizeRoute(route: string): string {
  const joined = resolvePosix('', route);
  return joined === '' ? '/' : `/${joined}`;
}

/**
 * The core of "routing is the directory structure": strip `.md`, and let
 * `index` collapse into the directory that contains it.
 */
export function filePathToRoute(filePath: string): string {
  const normalized = normalizeFilePath(filePath);
  const withoutExt = normalized.replace(MD_EXT, '');
  const segments = withoutExt.split('/').filter(Boolean);
  if (segments[segments.length - 1] === 'index') segments.pop();
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/** Route of the directory a route sits in. `/a/b` -> `/a`; `/a` -> `/`. */
export function parentRoute(route: string): string {
  const normalized = normalizeRoute(route);
  if (normalized === '/') return '/';
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}

/** `''` for a root-level basename, otherwise a leading-slash, no-trailing-slash prefix. */
export function normalizeBasename(basename: string | undefined): string {
  if (!basename) return '';
  const joined = resolvePosix('', basename);
  return joined === '' ? '' : `/${joined}`;
}

/** Turn a route into a browser href: percent-encode each segment, prepend the basename. */
export function routeToHref(route: string, basename?: string, fragment?: string): string {
  const prefix = normalizeBasename(basename);
  const normalized = normalizeRoute(route);
  const encoded =
    normalized === '/'
      ? '/'
      : `/${normalized
          .slice(1)
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/')}`;
  const path = prefix === '' ? encoded : `${prefix}${encoded === '/' ? '' : encoded}` || '/';
  return fragment ? `${path}#${fragment}` : path;
}

/**
 * Turn a browser pathname into a route. Returns `null` when the pathname falls
 * outside the basename, so callers can decline to handle it.
 */
export function hrefToRoute(pathname: string, basename?: string): string | null {
  const prefix = normalizeBasename(basename);
  let rest = pathname;
  if (prefix !== '') {
    if (rest === prefix) rest = '/';
    else if (rest.startsWith(`${prefix}/`)) rest = rest.slice(prefix.length);
    else return null;
  }
  return normalizeRoute(decodeSegments(rest));
}

/**
 * Percent-decode each segment of a path, leaving alone any that is not valid
 * encoding.
 *
 * Browsers percent-encode a pathname and so do markdown renderers, while a
 * bundle is keyed by the characters themselves: `café.md` arrives as
 * `caf%C3%A9.md`. Decoding is what lets a path outside ASCII match the file it
 * names. Per segment rather than whole, so an encoded separator stays inside
 * the segment that carried it, and a stray `%` costs one segment rather than
 * the link.
 */
export function decodeSegments(path: string): string {
  if (!path.includes('%')) return path;
  return path
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

export type HrefKind = 'external' | 'anchor' | 'document' | 'asset';

export interface ResolvedHref {
  kind: HrefKind;
  /** Bundle-relative file path, for `document` and `asset`. */
  path?: string;
  /** Route, for `document`. */
  route?: string;
  /** Fragment without the `#`. */
  fragment?: string;
  /** Query string without the `?`. */
  search?: string;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Classify a markdown href against the document that contains it.
 *
 * Handles all three forms OKF bundles use: bundle-absolute (`/tables/x.md`),
 * explicitly relative (`./x.md`, `../y/x.md`), and bare relative (`x.md`).
 */
export function classifyHref(href: string, fromDir: string): ResolvedHref {
  const trimmed = href.trim();
  if (trimmed === '') return { kind: 'anchor', fragment: '' };
  if (trimmed.startsWith('#')) return { kind: 'anchor', fragment: trimmed.slice(1) };
  if (trimmed.startsWith('//') || SCHEME.test(trimmed)) return { kind: 'external' };

  const hashIndex = trimmed.indexOf('#');
  const fragment = hashIndex === -1 ? undefined : trimmed.slice(hashIndex + 1);
  const withoutHash = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex);

  const queryIndex = withoutHash.indexOf('?');
  const search = queryIndex === -1 ? undefined : withoutHash.slice(queryIndex + 1);
  const withoutQuery = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);

  // Decoded before resolution so `..` and the separators are read as written,
  // and so the segments that remain are the characters the bundle is keyed by.
  const target = decodeSegments(withoutQuery);

  // A leading slash means bundle-relative, not filesystem- or origin-relative.
  const path = target.startsWith('/')
    ? normalizeFilePath(target)
    : resolvePosix(fromDir, target);

  if (isMarkdownPath(path)) {
    return { kind: 'document', path, route: filePathToRoute(path), fragment, search };
  }
  return { kind: 'asset', path, fragment, search };
}
