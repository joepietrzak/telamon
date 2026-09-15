import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PluggableList } from 'unified';
import { isBundle, parseBundle } from '../bundle/parse.js';
import { isReferenceDoc, referenceRoutes } from '../bundle/references.js';
import type { Bundle, BundleDiagnostic, OkfDoc } from '../bundle/types.js';
import { createHistoryRouter } from '../router/history.js';
import { RouterProvider, useRoute } from '../router/context.js';
import type { RouterAdapter } from '../router/types.js';
import { Layout } from './Layout.js';
import { OkfRoutes } from './OkfRoutes.js';
import { OkfContextProvider, type ReferencesState } from './context.js';
import { DEFAULT_SLOTS } from './defaults.js';
import type {
  MarkdownComponents,
  OkfConfig,
  OkfFeatures,
  OkfSlotName,
  OkfSlots,
  ResolvedSlots,
} from './slots.js';

export interface OkfSiteProps {
  /** A parsed bundle, or a raw map of bundle-relative path to file contents. */
  bundle: Bundle | Record<string, string>;
  /** Site title in the header. Defaults to the bundle root's title. */
  title?: string;
  /** Sub-path the site is mounted at. Ignored when a `router` is supplied. */
  basename?: string;
  /** Defer URL ownership to a host router. Defaults to a History API router. */
  router?: RouterAdapter;
  /** Replace whole regions of the page. */
  components?: Partial<OkfSlots>;
  /** Replace individual rendered markdown elements. */
  markdownComponents?: MarkdownComponents;
  /** Extra classes merged into the default `okf-*` class of each named region. */
  classNames?: Partial<Record<OkfSlotName, string>>;
  features?: OkfFeatures;
  /** Render fenced code blocks; without one, code renders unhighlighted. */
  highlightCode?: (code: string, language: string | undefined) => ReactNode;
  /** Map a bundle-relative asset path to a URL the browser can load. */
  resolveAssetUrl?: (bundlePath: string) => string;
  /** Colour for a concept `type` in the graph. */
  typeColor?: (type: string) => string | undefined;
  /** Route the graph is mounted at. Defaults to `/graph`. */
  graphRoute?: string;
  /** Clock for staleness checks. Defaults to the current time. */
  now?: Date;
  /**
   * Identifies provenance-only concepts that the references toggle hides.
   * Defaults to anything under a `references/` directory.
   */
  isReference?: (doc: OkfDoc) => boolean;
  /** Initial toggle state when uncontrolled. Defaults to showing references. */
  defaultShowReferences?: boolean;
  /** Controlled toggle state. Pair with `onShowReferencesChange`. */
  showReferences?: boolean;
  onShowReferencesChange?: (next: boolean) => void;
  /** Parse-time: keep raw HTML nodes. See `PipelineOptions`. Ignored for a parsed bundle. */
  allowHtml?: boolean;
  /** Parse-time. Memoize these; a new array each render re-parses the bundle. */
  remarkPlugins?: PluggableList;
  /** Parse-time. Memoize these; a new array each render re-parses the bundle. */
  rehypePlugins?: PluggableList;
  onNavigate?: (route: string) => void;
  onDiagnostics?: (diagnostics: BundleDiagnostic[]) => void;
  /** Shorthand for the `NotFound` slot. */
  renderNotFound?: (route: string) => ReactNode;
}

const DEFAULT_FEATURES: Required<OkfFeatures> = {
  search: true,
  graph: true,
  backlinks: true,
  toc: true,
  referenceToggle: true,
  download: true,
};

const NO_ROUTES: ReadonlySet<string> = new Set();

const EMPTY = {};

function NavigationReporter({ onNavigate }: { onNavigate: (route: string) => void }) {
  const { route } = useRoute();
  useEffect(() => {
    onNavigate(route);
  }, [route, onNavigate]);
  return null;
}

export interface OkfProviderProps extends OkfSiteProps {
  children: ReactNode;
}

/**
 * Everything `OkfSite` needs except the chrome: parses the bundle, builds the
 * configuration, and installs the router. Use it directly to keep the routing,
 * markdown rendering, and hooks while supplying your own layout.
 */
export function OkfProvider({
  bundle: input,
  title,
  basename,
  router: routerProp,
  components,
  markdownComponents,
  classNames,
  features,
  highlightCode,
  resolveAssetUrl,
  typeColor,
  graphRoute = '/graph',
  now,
  isReference = isReferenceDoc,
  defaultShowReferences = true,
  showReferences,
  onShowReferencesChange,
  allowHtml,
  remarkPlugins,
  rehypePlugins,
  onNavigate,
  onDiagnostics,
  renderNotFound,
  children,
}: OkfProviderProps) {
  const bundle = useMemo(
    () =>
      isBundle(input)
        ? input
        : parseBundle(input, {
            ...(allowHtml !== undefined && { allowHtml }),
            ...(remarkPlugins && { remarkPlugins }),
            ...(rehypePlugins && { rehypePlugins }),
          }),
    [input, allowHtml, remarkPlugins, rehypePlugins],
  );

  const router = useMemo(
    () => routerProp ?? createHistoryRouter({ ...(basename !== undefined && { basename }) }),
    [routerProp, basename],
  );

  const clock = useMemo(() => now ?? new Date(), [now]);

  const slots = useMemo<ResolvedSlots>(() => {
    const merged: ResolvedSlots = { ...DEFAULT_SLOTS, ...components };
    if (renderNotFound && !components?.NotFound) {
      merged.NotFound = function RenderNotFound({ route }) {
        return <>{renderNotFound(route)}</>;
      };
    }
    return merged;
  }, [components, renderNotFound]);

  const config = useMemo<OkfConfig>(
    () => ({
      title: title ?? bundle.root?.frontmatter.title ?? bundle.root?.title ?? 'Knowledge bundle',
      features: { ...DEFAULT_FEATURES, ...features },
      classNames: classNames ?? EMPTY,
      slots,
      markdownComponents: markdownComponents ?? EMPTY,
      ...(highlightCode && { highlightCode }),
      ...(resolveAssetUrl && { resolveAssetUrl }),
      ...(typeColor && { typeColor }),
      now: clock,
      graphRoute,
    }),
    [
      title,
      bundle,
      features,
      classNames,
      slots,
      markdownComponents,
      highlightCode,
      resolveAssetUrl,
      typeColor,
      clock,
      graphRoute,
    ],
  );

  // Uncontrolled by default; `showReferences` takes over when supplied.
  const [internalShowReferences, setInternalShowReferences] = useState(defaultShowReferences);
  const referencesVisible = showReferences ?? internalShowReferences;
  const setReferencesVisible = useCallback(
    (next: boolean) => {
      if (showReferences === undefined) setInternalShowReferences(next);
      onShowReferencesChange?.(next);
    },
    [showReferences, onShowReferencesChange],
  );

  const referenceRouteSet = useMemo(
    () => referenceRoutes(bundle, isReference),
    [bundle, isReference],
  );

  const references = useMemo<ReferencesState>(
    () => ({
      available: referenceRouteSet.size > 0,
      visible: referencesVisible,
      setVisible: setReferencesVisible,
      hidden: referencesVisible ? NO_ROUTES : referenceRouteSet,
    }),
    [referenceRouteSet, referencesVisible, setReferencesVisible],
  );

  useEffect(() => {
    if (onDiagnostics) onDiagnostics(bundle.diagnostics);
  }, [bundle, onDiagnostics]);

  return (
    <RouterProvider router={router}>
      <OkfContextProvider bundle={bundle} config={config} references={references}>
        {onNavigate ? <NavigationReporter onNavigate={onNavigate} /> : null}
        {children}
      </OkfContextProvider>
    </RouterProvider>
  );
}

/**
 * Render an OKF bundle as a complete single-page app.
 *
 * Routing follows the bundle's own directory structure, each page is the
 * rendered markdown of one file, and every visual value comes from `--okf-*`
 * custom properties -- so styling this is a matter of supplying design tokens
 * rather than overriding component internals.
 */
export function OkfSite(props: OkfSiteProps) {
  return (
    <OkfProvider {...props}>
      <Layout>
        <OkfRoutes />
      </Layout>
    </OkfProvider>
  );
}
