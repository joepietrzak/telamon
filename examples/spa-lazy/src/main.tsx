import { StrictMode, useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OkfSite, parseBundle, updateBundle, type Bundle } from 'telamon';
import 'telamon/tokens.css';
import 'telamon/styles.css';
import { MANIFEST } from 'virtual:okf-manifest';

/**
 * The bodies, one chunk each.
 *
 * `import.meta.glob` without `eager` compiles to a dynamic import per file, so
 * Rollup emits every document as its own hashed chunk and nothing is fetched
 * until something asks for it.
 */
const BODIES = import.meta.glob('../bundle/**/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

const PREFIX = '../bundle/';

function LazySite() {
  // The first bundle is the whole corpus minus its prose: every route, title,
  // type, tag and link, and no bodies. Enough to draw the nav, answer a
  // search, and lay out the graph.
  const filesRef = useRef<Record<string, string>>({ ...MANIFEST });
  const bundleRef = useRef<Bundle>(parseBundle(filesRef.current));
  const [bundle, setBundle] = useState<Bundle>(bundleRef.current);
  const asked = useRef(new Set<string>());

  const onNavigate = useCallback((route: string) => {
    const filePath = bundleRef.current.byRoute.get(route)?.filePath;
    if (filePath === undefined || asked.current.has(filePath)) return;
    const loader = BODIES[`${PREFIX}${filePath}`];
    if (loader === undefined) return;
    asked.current.add(filePath);

    void loader().then((text) => {
      if (filesRef.current[filePath] === text) return;
      filesRef.current = { ...filesRef.current, [filePath]: text };
      // Re-parse one document and recompute what depends on the whole --
      // the alternative is `parseBundle` over the corpus on every navigation.
      const next = updateBundle(bundleRef.current, { changed: { [filePath]: text } });
      bundleRef.current = next;
      setBundle(next);
    });
  }, []);

  return <OkfSite bundle={bundle} title="GA4 analytics reference" onNavigate={onNavigate} />;
}

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root');
createRoot(root).render(
  <StrictMode>
    <LazySite />
  </StrictMode>,
);
