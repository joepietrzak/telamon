import { useRoute } from '../router/context.js';
import { useOkfBundle, useOkfConfig } from './context.js';
import { ConceptPage, DirectoryPage, IndexPage, LogPage } from './pages.js';

/**
 * Resolve the current route against the bundle.
 *
 * Precedence: a real document first, then the concept graph, then a directory
 * with no `index.md` of its own, then the not-found page. Documents outrank the
 * graph deliberately, so a bundle that happens to contain `graph.md` keeps its
 * own page.
 */
export function OkfRoutes() {
  const bundle = useOkfBundle();
  const config = useOkfConfig();
  const { route } = useRoute();

  const doc = bundle.byRoute.get(route);
  if (doc) {
    if (doc.kind === 'concept') return <ConceptPage doc={doc} />;
    if (doc.kind === 'log') return <LogPage doc={doc} />;
    return <IndexPage doc={doc} label={bundle.directories.get(route)?.label ?? doc.title} />;
  }

  if (config.features.graph && route === config.graphRoute) {
    return <config.slots.Graph />;
  }

  const directory = bundle.directories.get(route);
  if (directory) return <DirectoryPage node={directory} />;

  const { NotFound } = config.slots;
  return <NotFound route={route} />;
}
