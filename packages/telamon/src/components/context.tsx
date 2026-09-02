import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { getSearchIndex, type SearchResult } from '../bundle/search.js';
import type { Bundle, DocRef, NavNode, OkfDoc } from '../bundle/types.js';
import { useRoute } from '../router/context.js';
import { cx, type OkfConfig, type OkfSlotName } from './slots.js';

interface OkfContextValue {
  bundle: Bundle;
  config: OkfConfig;
}

const OkfContext = createContext<OkfContextValue | null>(null);

/** The document currently being rendered, so markdown links resolve against the right directory. */
const DocContext = createContext<OkfDoc | null>(null);

export function OkfContextProvider({
  bundle,
  config,
  children,
}: {
  bundle: Bundle;
  config: OkfConfig;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ bundle, config }), [bundle, config]);
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

export function useNavTree(): NavNode[] {
  return useOkfBundle().tree;
}

export function useBacklinks(route: string): DocRef[] {
  const bundle = useOkfBundle();
  return bundle.backlinks.get(route) ?? [];
}

/**
 * Query the bundle. The index is built on first use and memoized per bundle, so
 * a site that never opens search never pays for it.
 */
export function useSearch(query: string, limit = 20): SearchResult[] {
  const bundle = useOkfBundle();
  return useMemo(
    () => (query.trim() === '' ? [] : getSearchIndex(bundle).search(query, limit)),
    [bundle, query, limit],
  );
}
