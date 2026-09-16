/**
 * `telamon/server` -- serve a bundle, rendered on the server.
 *
 * Node-side. Pair it with a source from `telamon/source` or `telamon/db`: the
 * handler takes web standard `Request` and `Response` and never learns whether
 * the bundle came off a disk or out of a warehouse.
 *
 * The page it sends carries the route's markup and nothing else. Search, the
 * and the graph are answered by the server, so page weight
 * does not grow with the corpus.
 */
export {
  createBundleHandler,
  type BundleHandler,
  type BundleHandlerOptions,
  type RefreshOptions,
} from './handler.js';

export { searchBundle, type ServerSearch } from './search.js';

export { navChildren, type NavChild } from './nav.js';

export {
  SearchResultsPage,
  ServerReferencesToggle,
  ServerSearchBox,
  type SearchResultsPageProps,
  type ServerChromeUrls,
} from './chrome.js';

export {
  ASSET_PREFIX,
  ENHANCE_SCRIPT_ID,
  ROOT_ELEMENT_ID,
  type EnhancePayload,
} from './ids.js';

export { escapeHtml, renderDocument, type DocumentOptions } from './document.js';
