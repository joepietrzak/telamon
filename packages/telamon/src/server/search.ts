import { getSearchIndex, type SearchResult } from '../bundle/search.js';
import { referenceRoutes } from '../bundle/references.js';
import type { Bundle, OkfDoc } from '../bundle/types.js';

export interface ServerSearch {
  results: SearchResult[];
  /** Matches withheld because reference concepts are hidden. */
  hiddenMatches: number;
}

/**
 * Run a query on the server.
 *
 * Mirrors `useSearch`, including over-fetching before filtering so hidden
 * references do not eat result slots, and counting what was withheld so the
 * reader is told why a match they expected is missing.
 */
export function searchBundle(
  bundle: Bundle,
  query: string,
  options: {
    limit?: number;
    showReferences?: boolean;
    isReference?: (doc: OkfDoc) => boolean;
  } = {},
): ServerSearch {
  const { limit = 20, showReferences = true, isReference } = options;
  if (query.trim() === '') return { results: [], hiddenMatches: 0 };

  const index = getSearchIndex(bundle);
  if (showReferences) return { results: index.search(query, limit), hiddenMatches: 0 };

  const hidden = referenceRoutes(bundle, isReference);
  if (hidden.size === 0) return { results: index.search(query, limit), hiddenMatches: 0 };

  const all = index.search(query, Math.max(limit * 5, 100));
  const results = all.filter((result) => !hidden.has(result.route)).slice(0, limit);
  return { results, hiddenMatches: all.length - results.length };
}
