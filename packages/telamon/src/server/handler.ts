import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { parseBundle } from '../bundle/parse.js';
import { diffFiles, filesToReparse, updateBundle } from '../bundle/update.js';
import { hrefToRoute } from '../bundle/paths.js';
import type { Bundle, BundleDiagnostic, OkfDoc } from '../bundle/types.js';
import { Layout } from '../components/Layout.js';
import { OkfProvider, OkfSite, type OkfSiteProps } from '../components/OkfSite.js';
import GraphView from '../components/graph/GraphView.js';
import type { OkfFeatures, OkfSlots } from '../components/slots.js';
import { createHistoryRouter } from '../router/history.js';
import type { BundleSource, SourceCursor, SourceDiagnostic } from '../source/types.js';
import {
  ServerReferencesToggle,
  ServerSearchBox,
  SearchResultsPage,
  type ServerChromeUrls,
} from './chrome.js';
import { renderDocument } from './document.js';
import { ASSET_PREFIX, ENHANCE_SCRIPT_ID, ROOT_ELEMENT_ID, type EnhancePayload } from './ids.js';
import { navChildren } from './nav.js';
import { searchBundle } from './search.js';

const SEARCH_LIMIT = 20;

export interface BundleHandlerOptions {
  /** Where the bundle comes from: a directory, a database, anything. */
  source: BundleSource;
  /** Site title. Defaults to the bundle root's own. */
  title?: string;
  /** Sub-path the site is mounted at, e.g. `/docs`. */
  basename?: string;
  features?: OkfFeatures;
  graphRoute?: string;
  /** Route the server renders search results at. Defaults to `/search`. */
  searchRoute?: string;
  /** Where the endpoints and scripts live. Defaults to `/_telamon`. */
  assetPrefix?: string;
  /**
   * Send the enhancement script. On by default.
   *
   * Every feature works without it -- search is a form,
   * the references toggle is a link, the graph is rendered -- so turning it off
   * costs polish rather than function.
   */
  enhance?: boolean;
  /** URL of the enhancement script. Defaults to `{assetPrefix}/enhance.js`. */
  enhanceSrc?: string;
  /** Stylesheet URLs for the document head. */
  stylesheets?: string[];
  /** Extra markup for the head, e.g. a font link or an analytics tag. */
  head?: string;
  lang?: string;
  /** Identifies provenance-only concepts. As `OkfSite`. */
  isReference?: (doc: OkfDoc) => boolean;
  /** Re-read the source on every request rather than caching it. */
  noCache?: boolean;
  /** Called after each load, with everything the source and the parse reported. */
  onDiagnostics?: (diagnostics: {
    source: SourceDiagnostic[];
    bundle: BundleDiagnostic[];
  }) => void;
}

export interface RefreshOptions {
  /**
   * Read the whole source rather than asking what changed.
   *
   * The reconciling path: it sees deletions, and rebuilds anything the
   * incremental read leaves alone.
   */
  full?: boolean;
}

export interface BundleHandler {
  (request: Request): Promise<Response>;
  /**
   * Read and parse the bundle now, rather than on the first request.
   *
   * Without this the first visitor pays for the read and the parse, which on a
   * large bundle is seconds. Worse, under an orchestrator the process is
   * "up" before it knows whether the source is even readable, so a pod with an
   * unmounted volume or an unreachable database passes its checks and then
   * fails live traffic. `await handler.warm()` before you listen and a broken
   * source is a startup failure, which is what it is.
   */
  warm(): Promise<void>;
  /**
   * Re-read the source and fold in what changed.
   *
   * Cheaper than `invalidate()` by the ratio of unchanged documents to changed
   * ones, because markdown parsing is the expensive part of reading a bundle
   * and it is skipped for every file whose contents are the same. On a bundle
   * of two thousand documents, a handful of edits costs milliseconds where a
   * full re-read costs seconds -- which is what makes refreshing often enough
   * to feel live affordable at all.
   *
   * When the source can say what changed, only that is read -- so the query
   * shrinks as well as the parse. That answer can be narrower than the truth:
   * a database sees edits but not deletions, and leaves synthesized index
   * files alone. `refresh({ full: true })` reads everything and reconciles,
   * which is worth doing on a slower cycle underneath.
   *
   * Resolves once the new bundle is in place. Returns the number of files that
   * were re-parsed, for logging.
   */
  refresh(options?: RefreshOptions): Promise<number>;
  /** Drop the cached bundle, so the next request re-reads and re-parses it all. */
  invalidate(): void;
  /** Stop watching the source. */
  close(): void;
}

interface Loaded {
  bundle: Bundle;
  files: Record<string, string>;
  /** Where the source got to, when it can resume. */
  cursor?: SourceCursor;
}

const html = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(new TextEncoder().encode(body).byteLength),
    },
  });

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/**
 * Serve a bundle, rendered on the server.
 *
 * The page that reaches the browser carries the route's markup and nothing
 * else: no bundle, no corpus, no parse to redo. The features that do want the
 * whole bundle ask the server for exactly what they need -- a search query, a
 * level of the navigation tree -- so a page stays the same size whether the
 * bundle holds ten documents or ten thousand.
 *
 * Takes and returns web standard `Request` and `Response`, so the same handler
 * runs under Node's `http` server, a worker runtime, or any framework that
 * speaks fetch.
 */
export function createBundleHandler(options: BundleHandlerOptions): BundleHandler {
  const {
    source,
    title,
    basename,
    features,
    graphRoute = '/graph',
    searchRoute = '/search',
    assetPrefix = ASSET_PREFIX,
    enhance = true,
    enhanceSrc = `${assetPrefix}/enhance.js`,
    stylesheets = [`${assetPrefix}/tokens.css`, `${assetPrefix}/styles.css`],
    head,
    lang = 'en',
    isReference,
    noCache = false,
    onDiagnostics,
  } = options;

  const urls: ServerChromeUrls = { searchRoute, assetPrefix };
  let cached: Promise<Loaded> | undefined;

  async function build(): Promise<Loaded> {
    const { files, diagnostics, cursor } = await source.load();
    const bundle = parseBundle(files);
    onDiagnostics?.({ source: diagnostics, bundle: bundle.diagnostics });
    return { bundle, files, ...(cursor !== undefined && { cursor }) };
  }

  function loaded(): Promise<Loaded> {
    if (noCache) return build();
    // Cache the promise rather than the result, so concurrent first requests
    // share one read instead of racing to do the same work.
    cached ??= build().catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
    return cached;
  }

  const stopWatching = source.watch?.(() => {
    cached = undefined;
  });

  const handler = async (request: Request): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }

    const url = new URL(request.url);

    // Endpoints first: they are the whole reason the page needs no bundle.
    if (url.pathname.startsWith(`${assetPrefix}/`)) {
      const endpoint = url.pathname.slice(assetPrefix.length + 1);

      if (endpoint === 'search.json') {
        const { bundle } = await loaded();
        const found = searchBundle(bundle, url.searchParams.get('q') ?? '', {
          limit: Number(url.searchParams.get('limit')) || SEARCH_LIMIT,
          showReferences: url.searchParams.get('references') !== '0',
          ...(isReference && { isReference }),
        });
        return json(found);
      }

      if (endpoint === 'health') {
        // Readiness, not liveness: it answers "can this process serve a page",
        // which means it must have the bundle. It shares the same cached read,
        // so a probe warms the pod rather than duplicating the work.
        try {
          const { bundle: loadedBundle } = await loaded();
          return json({
            status: 'ok',
            documents: loadedBundle.docs.length,
            diagnostics: loadedBundle.diagnostics.length,
          });
        } catch (error) {
          return new Response(
            JSON.stringify({
              status: 'error',
              message: error instanceof Error ? error.message : String(error),
            }),
            { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } },
          );
        }
      }

      if (endpoint === 'nav.json') {
        const { bundle } = await loaded();
        const children = navChildren(bundle, url.searchParams.get('route') ?? '/', {
          showReferences: url.searchParams.get('references') !== '0',
          ...(isReference && { isReference }),
        });
        if (!children) return new Response('Not found', { status: 404 });
        return json({ children });
      }

      return new Response('Not found', { status: 404 });
    }

    const { bundle } = await loaded();
    const route = hrefToRoute(url.pathname, basename);

    // Outside the basename entirely: not this site's URL to answer for.
    if (route === null) return new Response('Not found', { status: 404 });

    const siteTitle = title ?? titleOf(bundle);
    const showReferences = url.searchParams.get('references') !== '0';
    const query = url.searchParams.get('q') ?? '';
    const now = new Date();

    const router = createHistoryRouter({
      ...(basename !== undefined && { basename }),
      serverRoute: route,
    });

    const components: Partial<OkfSlots> = {
      SearchBox: () => createElement(ServerSearchBox, { urls, query }),
      ReferencesToggle: () => createElement(ServerReferencesToggle, { route }),
      // Eager: `lazy` suspends, and a render that cannot wait would emit the
      // loading fallback as the finished page.
      Graph: GraphView,
    };

    const siteProps: OkfSiteProps = {
      bundle,
      router,
      title: siteTitle,
      ...(basename !== undefined && { basename }),
      ...(features && { features }),
      ...(isReference && { isReference }),
      graphRoute,
      now,
      showReferences,
      components,
    };

    const isSearch = route === searchRoute;
    let body: string;
    let found: boolean;

    if (isSearch) {
      const results = searchBundle(bundle, query, {
        limit: SEARCH_LIMIT,
        showReferences,
        ...(isReference && { isReference }),
      });
      body = renderToString(
        createElement(OkfProvider, {
          ...siteProps,
          children: createElement(
            Layout,
            null,
            createElement(SearchResultsPage, { ...results, query, route }),
          ),
        }),
      );
      found = true;
    } else {
      const doc = bundle.byRoute.get(route);
      const directory = bundle.directories.get(route);
      const isGraph = features?.graph !== false && route === graphRoute;
      // Mirrors OkfRoutes: anything it would render is a 200, and only the page
      // it would show as not-found gets a 404 -- so a crawler and a reader agree.
      found = doc !== undefined || directory !== undefined || isGraph;
      body = renderToString(createElement(OkfSite, siteProps));
    }

    const pageTitle = pageTitleOf({ bundle, route, isSearch, query, siteTitle });

    const document = renderDocument({
      title: pageTitle,
      body,
      lang,
      stylesheets,
      rootId: ROOT_ELEMENT_ID,
      ...(head !== undefined && { head }),
      ...(enhance && {
        enhancement: {
          payload: JSON.stringify({
            searchRoute,
            assetPrefix,
            ...(basename !== undefined && { basename }),
          } satisfies EnhancePayload),
          src: enhanceSrc,
          scriptId: ENHANCE_SCRIPT_ID,
        },
      }),
    });

    return request.method === 'HEAD'
      ? new Response(null, {
          status: found ? 200 : 404,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-length': String(new TextEncoder().encode(document).byteLength),
          },
        })
      : html(document, found ? 200 : 404);
  };

  handler.warm = async () => {
    await loaded();
  };
  handler.refresh = async (refreshOptions: RefreshOptions = {}) => {
    // Nothing loaded yet: a first read is the cheapest possible refresh.
    if (cached === undefined) {
      await loaded();
      return 0;
    }

    const current = await cached;
    const incremental =
      refreshOptions.full !== true && source.loadChanged !== undefined && current.cursor !== undefined;

    if (incremental) {
      const { changed, deleted, diagnostics, cursor } = await source.loadChanged!(current.cursor!);
      // What the source offered is not what changed. A query for rows past a
      // watermark hands back whole rows, and a row can move without its
      // document differing by a byte -- so the work, and the number reported
      // for it, come from comparing contents rather than counting rows.
      const differing = Object.keys(changed).filter((path) => current.files[path] !== changed[path]);

      if (differing.length === 0 && deleted.length === 0) {
        // Still record where the source got to, so the next ask is narrower.
        cached = Promise.resolve({ ...current, cursor });
        return 0;
      }

      const files = { ...current.files };
      for (const path of deleted) delete files[path];
      Object.assign(files, changed);

      const bundle = updateBundle(current.bundle, { changed, deleted });
      onDiagnostics?.({ source: diagnostics, bundle: bundle.diagnostics });
      cached = Promise.resolve({ bundle, files, cursor });
      return filesToReparse(current.files, changed).size + deleted.length;
    }

    const { files, diagnostics, cursor } = await source.load();
    const changes = diffFiles(current.files, files);
    // `diffFiles` already reports only what differs, so anything here is real
    // work -- but an asset that is not markdown is not a parse, and the number
    // this returns is a count of parses.
    const moved = Object.keys(changes.changed ?? {}).length + (changes.deleted?.length ?? 0);

    if (moved === 0) {
      cached = Promise.resolve({ ...current, ...(cursor !== undefined && { cursor }) });
      return 0;
    }

    const bundle = updateBundle(current.bundle, changes);
    onDiagnostics?.({ source: diagnostics, bundle: bundle.diagnostics });
    cached = Promise.resolve({ bundle, files, ...(cursor !== undefined && { cursor }) });
    return filesToReparse(current.files, changes.changed ?? {}).size + (changes.deleted?.length ?? 0);
  };
  handler.invalidate = () => {
    cached = undefined;
  };
  handler.close = () => {
    stopWatching?.();
  };

  return handler;
}

function titleOf(bundle: Bundle): string {
  return bundle.root?.frontmatter.title ?? bundle.root?.title ?? 'Knowledge bundle';
}

function pageTitleOf(input: {
  bundle: Bundle;
  route: string;
  isSearch: boolean;
  query: string;
  siteTitle: string;
}): string {
  const { bundle, route, isSearch, query, siteTitle } = input;
  if (isSearch) {
    return query.trim() === '' ? `Search · ${siteTitle}` : `“${query.trim()}” · ${siteTitle}`;
  }
  const doc = bundle.byRoute.get(route);
  return doc && doc.route !== '/' ? `${doc.title} · ${siteTitle}` : siteTitle;
}
