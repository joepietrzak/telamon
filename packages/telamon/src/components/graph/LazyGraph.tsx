import { Suspense, lazy } from 'react';

// Lazy so `d3-force` and the graph view stay out of the initial chunk.
const GraphView = lazy(() => import('./GraphView.js'));

/**
 * The graph, fetched on demand.
 *
 * The default for the `Graph` slot. A server rendering the page with no
 * JavaScript behind it wants the eager `GraphView` instead: `lazy` suspends,
 * and a server render that cannot wait emits the fallback and nothing else.
 */
export function LazyGraph() {
  return (
    <Suspense fallback={<p className="okf-loading">Loading graph…</p>}>
      <GraphView />
    </Suspense>
  );
}
