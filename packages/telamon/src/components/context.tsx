import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { filterNavTree } from '../bundle/references.js';
import { getSearchIndex, type SearchResult } from '../bundle/search.js';
import type { Bundle, DocRef, NavNode, OkfDoc } from '../bundle/types.js';
import { useRoute } from '../router/context.js';
import { cx, type OkfConfig, type OkfSlotName } from './slots.js';

/**
 * Visibility of provenance-only reference concepts.
 *
 * Kept out of `OkfConfig` because it is mutable UI state rather than
 * configuration: flipping it must re-render, whereas the config object is
 * memoized from props.
 */
export interface ReferencesState {
  /** True when the bundle actually contains reference concepts. */
  available: boolean;
  visible: boolean;
  setVisible: (next: boolean) => void;
  /** Routes hidden while `visible` is false. Empty when it is true. */
  hidden: ReadonlySet<string>;
}

interface OkfContextValue {
  bundle: Bundle;
  config: OkfConfig;
  references: ReferencesState;
}

const OkfContext = createContext<OkfContextValue | null>(null);

/** The document currently being rendered, so markdown links resolve against the right directory. */
const DocContext = createContext<OkfDoc | null>(null);

export function OkfContextProvider({
  bundle,
  config,
  references,
  children,
}: {
  bundle: Bundle;
  config: OkfConfig;
  references: ReferencesState;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ bundle, config, references }),
    [bundle, config, references],
  );
  return <OkfContext.Provider value={value}>{children}</OkfContext.Provider>;
}

function useOkfContext(): OkfContextValue {
  const value = useContext(OkfContext);
  if (!value) throw new Error('This hook must be used inside <OkfSite>.');
  return value;
}

export function useOkfBundle(): Bundle {
  return useOkfContext().bundle;
}

export function useOkfConfig(): OkfConfig {
  return useOkfContext().config;
}

/** Default `okf-*` class for a slot, merged with any consumer override. */
export function useClassName(slot: OkfSlotName, ...extra: (string | false | undefined)[]): string {
  const { classNames } = useOkfConfig();
  return cx(`okf-${slot.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, ...extra, classNames[slot]);
}

export function DocProvider({ doc, children }: { doc: OkfDoc; children: ReactNode }) {
  return <DocContext.Provider value={doc}>{children}</DocContext.Provider>;
}

/** The document being rendered, or `null` outside a document body. */
export function useCurrentDoc(): OkfDoc | null {
  return useContext(DocContext);
}

/** Document at the current route, if the route resolves to one. */
export function useDoc(): OkfDoc | undefined {
  const bundle = useOkfBundle();
  const { route } = useRoute();
  return bundle.byRoute.get(route);
}

export function useReferences(): ReferencesState {
  return useOkfContext().references;
}

/** The navigation tree, with hidden reference branches pruned away. */
export function useNavTree(): NavNode[] {
  const bundle = useOkfBundle();
  const { hidden } = useReferences();
  return useMemo(() => filterNavTree(bundle.tree, hidden), [bundle.tree, hidden]);
}

export function useBacklinks(route: string): DocRef[] {
  const bundle = useOkfBundle();
  return bundle.backlinks.get(route) ?? [];
}

export interface UseSearchOptions {
  limit?: number;
  /** Include reference concepts even while the toggle hides them. */
  includeHidden?: boolean;
}

/**
 * Query the bundle. The index is built on first use and memoized per bundle, so
 * a site that never opens search never pays for it.
 */
export function useSearch(query: string, options: UseSearchOptions = {}): SearchResult[] {
  const { limit = 20, includeHidden = false } = options;
  const bundle = useOkfBundle();
  const { hidden } = useReferences();

  return useMemo(() => {
    if (query.trim() === '') return [];
    const index = getSearchIndex(bundle);
    if (includeHidden || hidden.size === 0) return index.search(query, limit);
    // Over-fetch before filtering, so hidden references do not eat result slots.
    return index
      .search(query, Math.max(limit * 5, 100))
      .filter((result) => !hidden.has(result.route))
      .slice(0, limit);
  }, [bundle, query, limit, includeHidden, hidden]);
}
