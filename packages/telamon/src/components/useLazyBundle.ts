import { useCallback, useRef, useState } from 'react';
import { parseBundle, type ParseOptions } from '../bundle/parse.js';
import { updateBundle } from '../bundle/update.js';
import type { Bundle } from '../bundle/types.js';

export interface LazyBundleOptions {
  /** Frontmatter of every document, keyed by bundle-relative path. */
  manifest: Record<string, string>;
  /** Loader per bundle-relative path, returning that document's full text. */
  bodies: Record<string, () => Promise<string>>;
  parse?: ParseOptions;
  /** Called when a body cannot be fetched. Defaults to `console.error`. */
  onError?: (filePath: string, error: unknown) => void;
}

export interface LazyBundle {
  /** Complete from the first render, with bodies filling in as they are read. */
  bundle: Bundle;
  /** Pass to `OkfSite`'s `onNavigate`; it is what asks for the next body. */
  onNavigate: (route: string) => void;
}

/**
 * A bundle whose bodies arrive as they are read.
 *
 * Pair with the `okfManifest` Vite plugin, which produces both arguments:
 *
 * ```tsx
 * import { MANIFEST, BODIES } from 'virtual:okf-manifest';
 *
 * const { bundle, onNavigate } = useLazyBundle({ manifest: MANIFEST, bodies: BODIES });
 * return <OkfSite bundle={bundle} onNavigate={onNavigate} />;
 * ```
 *
 * The first parse sees every document's frontmatter and no prose, which is
 * enough for the navigation tree, the graph, backlinks, and search over titles
 * and descriptions. Each navigation then fetches one body and folds it in with
 * `updateBundle`, which re-parses that document and leaves the rest alone.
 *
 * What this does not do is make full-text search work before the text has
 * arrived. Search reads what is in the bundle, so until a document has been
 * opened it is findable by everything except its own prose. A corpus small
 * enough to ship whole should be shipped whole.
 */
export function useLazyBundle({
  manifest,
  bodies,
  parse,
  onError,
}: LazyBundleOptions): LazyBundle {
  // Refs rather than state for the working copies: a navigation reads the
  // bundle it is folding into, and reading that through a closure would fold
  // into whichever one the last render happened to capture.
  const filesRef = useRef<Record<string, string>>({ ...manifest });
  const bundleRef = useRef<Bundle | null>(null);
  bundleRef.current ??= parseBundle(filesRef.current, parse);

  const [bundle, setBundle] = useState<Bundle>(bundleRef.current);
  const asked = useRef(new Set<string>());

  const onNavigate = useCallback(
    (route: string) => {
      const current = bundleRef.current;
      if (current === null) return;
      const filePath = current.byRoute.get(route)?.filePath;
      if (filePath === undefined || asked.current.has(filePath)) return;
      const load = bodies[filePath];
      if (load === undefined) return;

      asked.current.add(filePath);
      void load().then(
        (text) => {
          if (filesRef.current[filePath] === text) return;
          filesRef.current = { ...filesRef.current, [filePath]: text };
          const next = updateBundle(bundleRef.current!, { changed: { [filePath]: text } }, parse);
          bundleRef.current = next;
          setBundle(next);
        },
        (error: unknown) => {
          // Let it be asked for again: a failed fetch is not an answer.
          asked.current.delete(filePath);
          if (onError) onError(filePath, error);
          else console.error(`[okf] could not load ${filePath}`, error);
        },
      );
    },
    [bodies, parse, onError],
  );

  return { bundle, onNavigate };
}
