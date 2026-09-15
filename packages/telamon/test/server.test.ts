// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createBundleHandler, ENHANCE_SCRIPT_ID, type EnhancePayload } from '../src/server/index.js';
import type { BundleSource } from '../src/source/index.js';
import { readFixture } from './helpers.js';

const demo = readFixture('demo');

/** A source with no disk behind it, and a count of how often it was read. */
function memorySource(files: Record<string, string> = demo) {
  const source: BundleSource & { loads: number; files: Record<string, string> } = {
    name: 'memory',
    loads: 0,
    files,
    load: async () => {
      source.loads += 1;
      return { files: source.files, diagnostics: [] };
    },
  };
  return source;
}

const get = (path: string, init?: RequestInit) =>
  new Request(`http://localhost${path}`, init);

/** Read back the settings the server sent the enhancement script. */
function settingsOf(html: string): EnhancePayload {
  const match = html.match(
    new RegExp(`<script id="${ENHANCE_SCRIPT_ID}" type="application/json">(.*?)</script>`, 's'),
  );
  if (!match) throw new Error('no settings in the document');
  return JSON.parse(match[1]!) as EnhancePayload;
}

/** A bundle of `count` documents, to watch what page weight does as it grows. */
function corpus(count: number): Record<string, string> {
  const files: Record<string, string> = { 'index.md': '# Root\n' };
  for (let i = 0; i < count; i += 1) {
    files[`metrics/metric_${i}.md`] =
      `---\ntype: Metric\ntitle: Metric ${i}\n---\n\nBody of metric ${i}. ` +
      `Distinctive filler so its presence in a page is unmistakable: zzqq${i}.\n`;
  }
  return files;
}

describe('serving a bundle', () => {
  it('renders a concept page as a whole HTML document', async () => {
    const handler = createBundleHandler({ source: memorySource() });
    const response = await handler(get('/metrics/gross_revenue'));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Gross revenue');
    // The page is readable and navigable before any JavaScript runs.
    expect(html).toContain('Total charged before refunds');
    expect(html).toContain('href="/tables/orders"');
  });

  it('answers with the status the page actually is', async () => {
    const handler = createBundleHandler({ source: memorySource() });

    expect((await handler(get('/'))).status).toBe(200);
    expect((await handler(get('/metrics'))).status).toBe(200);
    expect((await handler(get('/graph'))).status).toBe(200);

    // Still a rendered not-found page, but a crawler is told the truth.
    const missing = await handler(get('/nope'));
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('<!doctype html>');
  });

  it('sends the page and not the corpus', async () => {
    const handler = createBundleHandler({ source: memorySource(corpus(500)) });
    const html = await (await handler(get('/metrics/metric_0'))).text();

    // The page it asked for is there.
    expect(html).toContain('Body of metric 0');
    // The other 499 are not: no bundle travels with the page.
    expect(html).not.toContain('zzqq1.');
    expect(html).not.toContain('zzqq499');
  });

  it('does not grow when the documents do', async () => {
    // Fifty documents either way; only their size changes.
    const sized = (bodyBytes: number) => {
      const files: Record<string, string> = { 'index.md': '# Root\n' };
      for (let i = 0; i < 50; i += 1) {
        files[`metrics/metric_${i}.md`] =
          `---\ntype: Metric\ntitle: Metric ${i}\n---\n\n${'lorem '.repeat(bodyBytes / 6)}\n`;
      }
      return files;
    };
    const page = async (bodyBytes: number) => {
      const handler = createBundleHandler({ source: memorySource(sized(bodyBytes)) });
      return (await (await handler(get('/metrics/metric_0'))).text()).length;
    };

    const thin = await page(60);
    const fat = await page(60_000);

    // Every document got a thousand times longer. The page grew by one
    // document -- the one it renders -- because it carries no other body.
    // Embedding the bundle would have added three megabytes here.
    const growth = fat - thin;
    expect(growth).toBeGreaterThan(50_000);
    expect(growth).toBeLessThan(70_000);
  });

  it('grows with the navigation tree, which is the sidebar being honest', async () => {
    const page = async (count: number) => {
      const handler = createBundleHandler({ source: memorySource(corpus(count)) });
      return (await (await handler(get('/metrics/metric_0'))).text()).length;
    };

    // The sidebar lists every document, so more documents is a longer sidebar.
    // Worth knowing and worth stating: this, not content, is what scales.
    const [ten, thousand] = [await page(10), await page(1000)];
    expect(thousand).toBeGreaterThan(ten);
    // Still bounded by links rather than bodies: a few hundred bytes each.
    expect((thousand - ten) / 990).toBeLessThan(300);
  });

  it('tells the enhancement script where to look, and nothing more', async () => {
    const handler = createBundleHandler({ source: memorySource() });
    const html = await (await handler(get('/'))).text();
    const settings = settingsOf(html);

    expect(settings).toEqual({ searchRoute: '/search', assetPrefix: '/_telamon' });
    // Settings, not content: a few dozen bytes however large the bundle is.
    expect(JSON.stringify(settings).length).toBeLessThan(200);
  });

  it('cannot be closed early by markdown containing a script tag', async () => {
    const handler = createBundleHandler({
      source: memorySource({
        'index.md': '# Root\n\nInline: `</script><script>alert(1)</script>`\n',
      }),
    });
    const html = await (await handler(get('/'))).text();

    // Nothing executable got out: the markdown's angle brackets are entity
    // encoded in the body, so the only script elements in the document are the
    // two the server wrote itself.
    expect(html).not.toContain('<script>alert(1)');
    expect(html.match(/<\/script>/g) ?? []).toHaveLength(2);
    expect(html).toContain('&lt;/script&gt;');
  });

  it('serves no script at all when enhancement is off', async () => {
    const handler = createBundleHandler({ source: memorySource(), enhance: false });
    const html = await (await handler(get('/'))).text();

    expect(html).not.toContain(ENHANCE_SCRIPT_ID);
    expect(html).not.toContain('<script');
    // And every feature is still reachable, because none of them needed it.
    expect(html).toContain('href="/metrics"');
    expect(html).toContain('action="/search"');
    expect(html).toContain('href="/_telamon/bundle.zip"');
  });

  it('honours a basename, and disowns URLs outside it', async () => {
    const handler = createBundleHandler({ source: memorySource(), basename: '/docs' });

    const inside = await handler(get('/docs/metrics/gross_revenue'));
    expect(inside.status).toBe(200);
    expect(await inside.text()).toContain('href="/docs/tables/orders"');

    expect((await handler(get('/elsewhere'))).status).toBe(404);
  });

  it('takes the site title from the bundle, or from the option', async () => {
    const fromBundle = createBundleHandler({ source: memorySource() });
    expect(await (await fromBundle(get('/'))).text()).toContain('<title>Subdirectories</title>');

    const named = createBundleHandler({ source: memorySource(), title: 'Acme analytics' });
    const html = await (await named(get('/metrics/gross_revenue'))).text();
    expect(html).toContain('<title>Gross revenue · Acme analytics</title>');
  });
});

describe('the concept graph', () => {
  /** Enough nodes for the force simulation to cost something measurable. */
  function linkedCorpus(count: number): Record<string, string> {
    const files: Record<string, string> = { 'index.md': '# Root\n' };
    for (let i = 0; i < count; i += 1) {
      files[`metrics/metric_${i}.md`] =
        `---\ntype: Metric\ntitle: Metric ${i}\n---\n\n` +
        `Depends on [metric ${(i + 1) % count}](metric_${(i + 1) % count}.md) ` +
        `and [metric ${(i + 7) % count}](metric_${(i + 7) % count}.md).\n`;
    }
    return files;
  }

  it('settles the layout once per bundle, not once per request', async () => {
    const handler = createBundleHandler({ source: memorySource(linkedCorpus(250)) });

    const started = performance.now();
    const first = await handler(get('/graph'));
    const firstMs = performance.now() - started;

    const restarted = performance.now();
    const second = await handler(get('/graph'));
    const secondMs = performance.now() - restarted;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    // Timing, because a cached layout is observably identical to a recomputed
    // one -- the simulation is deterministic, which is what makes it cacheable.
    // The real margin is ~30x; five is enough to catch the cache going away.
    expect(secondMs * 5).toBeLessThan(firstMs);
  });

  it('serves the same graph to a reader who has hidden references', async () => {
    const handler = createBundleHandler({ source: memorySource(linkedCorpus(250)) });

    await handler(get('/graph'));
    const started = performance.now();
    const hidden = await handler(get('/graph?references=0'));
    const hiddenMs = performance.now() - started;

    // The toggle changes the sidebar, not the graph, so it shares the layout.
    expect(hidden.status).toBe(200);
    expect(hiddenMs).toBeLessThan(1000);
  });

  it('drops the layout when the bundle is re-read', async () => {
    const source = memorySource(linkedCorpus(250));
    const handler = createBundleHandler({ source });

    await handler(get('/graph'));
    handler.invalidate();

    // A new parse means a new graph object, so the old layout goes with the
    // old bundle rather than being served for content that has changed.
    const after = await handler(get('/graph'));
    expect(after.status).toBe(200);
    expect(source.loads).toBe(2);
  });
});

describe('the endpoints that replaced the bundle', () => {
  it('answers a search query as JSON', async () => {
    const handler = createBundleHandler({ source: memorySource() });
    const response = await handler(get('/_telamon/search.json?q=revenue'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');

    const found = (await response.json()) as { results: { route: string; title: string }[] };
    expect(found.results.length).toBeGreaterThan(0);
    expect(found.results.map((r) => r.route)).toContain('/metrics/gross_revenue');
  });

  it('withholds references when the reader has hidden them, and says how many', async () => {
    const handler = createBundleHandler({ source: memorySource() });

    const shown = (await (await handler(get('/_telamon/search.json?q=revenue'))).json()) as {
      results: unknown[];
      hiddenMatches: number;
    };
    const hidden = (await (
      await handler(get('/_telamon/search.json?q=revenue&references=0'))
    ).json()) as { results: { route: string }[]; hiddenMatches: number };

    expect(hidden.results.every((r) => !r.route.startsWith('/references/'))).toBe(true);
    expect(hidden.results.length).toBeLessThanOrEqual(shown.results.length);
    expect(hidden.hiddenMatches).toBeGreaterThan(0);
  });

  it('serves the sources as a zip the browser will save', async () => {
    const handler = createBundleHandler({ source: memorySource(), title: 'Acme analytics' });
    const response = await handler(get('/_telamon/bundle.zip'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="acme-analytics.zip"',
    );

    const bytes = new Uint8Array(await response.arrayBuffer());
    // A real local file header, not an error page with a zip content type.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Number(response.headers.get('content-length'))).toBe(bytes.length);
  });

  it('renders a search results page for a form submission', async () => {
    const handler = createBundleHandler({ source: memorySource(), title: 'Acme analytics' });
    const response = await handler(get('/search?q=revenue'));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<title>\u201Crevenue\u201D \u00b7 Acme analytics</title>');
    expect(html).toContain('href="/metrics/gross_revenue"');
    // Still the whole site: the results sit inside the usual chrome.
    expect(html).toContain('okf-sidebar');
  });

  it('renders the empty and no-match cases of that page', async () => {
    const handler = createBundleHandler({ source: memorySource() });

    expect(await (await handler(get('/search'))).text()).toContain('Type a query to search');
    expect(await (await handler(get('/search?q=zzzznothing'))).text()).toContain(
      'No matches for',
    );
  });

  it('puts the references state in the URL, where it can be linked', async () => {
    const handler = createBundleHandler({ source: memorySource() });

    const sidebarOf = (html: string) => {
      const start = html.indexOf('id="okf-sidebar"');
      return html.slice(start, html.indexOf('</aside>', start));
    };

    const shown = await (await handler(get('/'))).text();
    expect(shown).toContain('href="/?references=0"');
    expect(sidebarOf(shown)).toContain('href="/references"');

    const hidden = await (await handler(get('/?references=0'))).text();
    expect(hidden).toContain('Show references');
    expect(sidebarOf(hidden)).not.toContain('href="/references"');

    // Presentational only, as in the app: the root index authored a link to
    // the provenance tree in its own body, and that still resolves.
    expect(hidden).toContain('href="/references"');
  });

  it('reports readiness once the bundle is loadable', async () => {
    const handler = createBundleHandler({ source: memorySource() });
    const response = await handler(get('/_telamon/health'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      documents: 17,
      diagnostics: 0,
    });
  });

  it('reports 503 while the source cannot be read', async () => {
    let broken = true;
    const source: BundleSource = {
      name: 'flaky',
      load: async () => {
        if (broken) throw new Error('volume is not mounted');
        return { files: demo, diagnostics: [] };
      },
    };
    const handler = createBundleHandler({ source });

    const sick = await handler(get('/_telamon/health'));
    expect(sick.status).toBe(503);
    expect(await sick.json()).toEqual({
      status: 'error',
      message: 'volume is not mounted',
    });

    // A failed read is not cached, so recovery needs no restart.
    broken = false;
    expect((await handler(get('/_telamon/health'))).status).toBe(200);
  });

  it('answers health without rendering a page', async () => {
    // It must stay cheap enough to probe every few seconds.
    const source = memorySource();
    const handler = createBundleHandler({ source });

    await handler(get('/_telamon/health'));
    await handler(get('/_telamon/health'));
    await handler(get('/_telamon/health'));

    // One read shared by all of them, and no markup built.
    expect(source.loads).toBe(1);
  });

  it('serves one level of the navigation tree', async () => {
    const handler = createBundleHandler({ source: memorySource() });
    const response = await handler(get('/_telamon/nav.json?route=/metrics'));

    expect(response.status).toBe(200);
    const level = (await response.json()) as {
      children: { route: string; label: string; children: boolean }[];
    };

    expect(level.children.map((c) => c.route)).toEqual([
      '/metrics/gross_revenue',
      '/metrics/average_order_value',
      '/metrics/repeat_purchase_rate',
    ]);
    // Leaves say so, so the control knows not to offer an arrow.
    expect(level.children.every((c) => c.children === false)).toBe(true);
  });

  it('carries the labels and descriptions the sidebar renders', async () => {
    const handler = createBundleHandler({ source: memorySource() });
    const level = (await (await handler(get('/_telamon/nav.json?route=/'))).json()) as {
      children: { route: string; label: string; description?: string; children: boolean }[];
    };

    const metrics = level.children.find((c) => c.route === '/metrics')!;
    expect(metrics.label).toBe('metrics');
    expect(metrics.description).toContain('Agreed definitions');
    expect(metrics.children).toBe(true);
  });

  it('prunes references from a level when the reader has hidden them', async () => {
    const handler = createBundleHandler({ source: memorySource() });

    const shown = (await (await handler(get('/_telamon/nav.json?route=/'))).json()) as {
      children: { route: string }[];
    };
    const hidden = (await (
      await handler(get('/_telamon/nav.json?route=/&references=0'))
    ).json()) as { children: { route: string }[] };

    expect(shown.children.map((c) => c.route)).toContain('/references');
    expect(hidden.children.map((c) => c.route)).not.toContain('/references');
  });

  it('404s a level that is not in the tree', async () => {
    const handler = createBundleHandler({ source: memorySource() });
    expect((await handler(get('/_telamon/nav.json?route=/nowhere'))).status).toBe(404);
  });

  it('404s an endpoint it does not have', async () => {
    const handler = createBundleHandler({ source: memorySource() });
    expect((await handler(get('/_telamon/nope.json'))).status).toBe(404);
  });
});

describe('reading the source', () => {
  it('reads once and serves many, until invalidated', async () => {
    const source = memorySource();
    const handler = createBundleHandler({ source });

    await handler(get('/'));
    await handler(get('/metrics'));
    expect(source.loads).toBe(1);

    handler.invalidate();
    await handler(get('/'));
    expect(source.loads).toBe(2);
  });

  it('shares one read between requests that arrive together', async () => {
    const source = memorySource();
    const handler = createBundleHandler({ source });

    await Promise.all([handler(get('/')), handler(get('/metrics')), handler(get('/tables'))]);
    expect(source.loads).toBe(1);
  });

  it('re-reads every request when caching is off', async () => {
    const source = memorySource();
    const handler = createBundleHandler({ source, noCache: true });

    await handler(get('/'));
    await handler(get('/'));
    expect(source.loads).toBe(2);
  });

  it('drops the cache when the source says it changed', async () => {
    let fire = () => {};
    const source = memorySource();
    const watched: BundleSource = {
      ...source,
      watch: (onChange) => {
        fire = onChange;
        return () => {};
      },
    };

    const handler = createBundleHandler({ source: watched });
    await handler(get('/'));
    expect(source.loads).toBe(1);

    fire();
    await handler(get('/'));
    expect(source.loads).toBe(2);
  });

  it('warms on demand, so the first visitor does not pay for the parse', async () => {
    const source = memorySource();
    const handler = createBundleHandler({ source });

    expect(source.loads).toBe(0);
    await handler.warm();
    expect(source.loads).toBe(1);

    // And the request that follows reuses it.
    await handler(get('/'));
    expect(source.loads).toBe(1);
  });

  it('rejects from warm() when the source is unreadable', async () => {
    const handler = createBundleHandler({
      source: {
        name: 'missing',
        load: () => Promise.reject(new Error('no such directory')),
      },
    });

    // The point of warming: a broken source is a startup failure, not a
    // healthy-looking process that fails its first real request.
    await expect(handler.warm()).rejects.toThrow(/no such directory/);
  });

  it('retries after a failed read rather than caching the failure', async () => {
    let fail = true;
    const source: BundleSource = {
      name: 'flaky',
      load: async () => {
        if (fail) throw new Error('disk is having a moment');
        return { files: demo, diagnostics: [] };
      },
    };
    const handler = createBundleHandler({ source });

    await expect(handler(get('/'))).rejects.toThrow(/having a moment/);
    fail = false;
    expect((await handler(get('/'))).status).toBe(200);
  });

  it('reports what the source and the parse each found', async () => {
    const onDiagnostics = vi.fn();
    const source: BundleSource = {
      name: 'memory',
      load: async () => ({
        files: { 'orphan.md': '# No type in frontmatter' },
        diagnostics: [{ code: 'empty-source', severity: 'info', message: 'thin bundle' }],
      }),
    };

    await createBundleHandler({ source, onDiagnostics })(get('/'));

    expect(onDiagnostics).toHaveBeenCalledWith({
      source: [expect.objectContaining({ code: 'empty-source' })],
      bundle: [expect.objectContaining({ code: 'missing-type' })],
    });
  });
});

describe('refreshing', () => {
  it('folds in an edit without re-reading the whole bundle', async () => {
    const source = memorySource();
    const handler = createBundleHandler({ source });

    await handler.warm();
    expect(await (await handler(get('/metrics/gross_revenue'))).text()).toContain('Gross revenue');

    source.files = {
      ...demo,
      'metrics/gross_revenue.md': demo['metrics/gross_revenue.md']!.replace(
        'title: Gross revenue',
        'title: Gross revenue (restated)',
      ),
    };

    expect(await handler.refresh()).toBe(1);
    const html = await (await handler(get('/metrics/gross_revenue'))).text();
    expect(html).toContain('Gross revenue (restated)');
    // The sidebar is rebuilt too, not just the page.
    expect(html).toContain('Gross revenue (restated)');
  });

  it('picks up a new document, in the navigation as well as at its route', async () => {
    const source = memorySource();
    const handler = createBundleHandler({ source });
    await handler.warm();

    expect((await handler(get('/metrics/net_revenue'))).status).toBe(404);

    source.files = {
      ...demo,
      'metrics/net_revenue.md': '---\ntype: Metric\ntitle: Net revenue\n---\n\nAfter refunds.\n',
    };
    expect(await handler.refresh()).toBe(1);

    const page = await handler(get('/metrics/net_revenue'));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('After refunds');

    const level = (await (await handler(get('/_telamon/nav.json?route=/metrics'))).json()) as {
      children: { route: string }[];
    };
    expect(level.children.map((c) => c.route)).toContain('/metrics/net_revenue');
  });

  it('picks up a deletion, and reports the route gone', async () => {
    const source = memorySource();
    const handler = createBundleHandler({ source });
    await handler.warm();

    const remaining = { ...demo };
    delete remaining['metrics/gross_revenue.md'];
    source.files = remaining;

    expect(await handler.refresh()).toBe(1);
    expect((await handler(get('/metrics/gross_revenue'))).status).toBe(404);
  });

  it('does nothing when the source has not changed', async () => {
    const source = memorySource();
    const handler = createBundleHandler({ source });
    await handler.warm();

    expect(await handler.refresh()).toBe(0);
    // It still had to read the source to find that out.
    expect(source.loads).toBe(2);
  });

  it('reads once when nothing is loaded yet', async () => {
    const source = memorySource();
    const handler = createBundleHandler({ source });

    expect(await handler.refresh()).toBe(0);
    expect(source.loads).toBe(1);
    expect((await handler(get('/'))).status).toBe(200);
    expect(source.loads).toBe(1);
  });

  it('keeps serving the old bundle if the re-read fails', async () => {
    const source = memorySource();
    const handler = createBundleHandler({ source });
    await handler.warm();

    source.load = async () => {
      throw new Error('warehouse unreachable');
    };

    await expect(handler.refresh()).rejects.toThrow(/unreachable/);
    // The page is still there, served from what was loaded before.
    expect((await handler(get('/metrics/gross_revenue'))).status).toBe(200);
  });
});

describe('refreshing from a source that knows what changed', () => {
  /** A source with a cursor, so the handler takes the incremental path. */
  function trackingSource(files: Record<string, string> = demo) {
    const source: BundleSource & {
      files: Record<string, string>;
      fullReads: number;
      incrementalReads: number;
      pending: { changed: Record<string, string>; deleted: string[] };
    } = {
      name: 'tracking',
      files,
      fullReads: 0,
      incrementalReads: 0,
      pending: { changed: {}, deleted: [] },
      load: async () => {
        source.fullReads += 1;
        return { files: source.files, diagnostics: [], cursor: 'v1' };
      },
      loadChanged: async () => {
        source.incrementalReads += 1;
        const { changed, deleted } = source.pending;
        source.pending = { changed: {}, deleted: [] };
        return { changed, deleted, diagnostics: [], cursor: 'v2' };
      },
    };
    return source;
  }

  it('asks only for what changed', async () => {
    const source = trackingSource();
    const handler = createBundleHandler({ source });
    await handler.warm();
    expect(source.fullReads).toBe(1);

    source.pending = {
      changed: {
        'metrics/gross_revenue.md': demo['metrics/gross_revenue.md']!.replace(
          'title: Gross revenue',
          'title: Gross revenue (restated)',
        ),
      },
      deleted: [],
    };

    expect(await handler.refresh()).toBe(1);
    expect(source.incrementalReads).toBe(1);
    // The whole source was never re-read.
    expect(source.fullReads).toBe(1);
    expect(await (await handler(get('/metrics/gross_revenue'))).text()).toContain(
      'Gross revenue (restated)',
    );
  });

  /**
   * A watermark query hands back whole rows, and a row can move without its
   * document differing by a byte -- a re-sync that rewrites `updated_at`, or a
   * first read seeded with a cursor that matched everything. Counting rows
   * would report two thousand files re-parsed in a second and a half, when two
   * thousand files take half a minute to parse and none of them were touched.
   */
  it('counts the files it parsed, not the rows the source offered', async () => {
    const source = trackingSource();
    const handler = createBundleHandler({ source });
    await handler.warm();

    // Every file, byte-identical: the source cannot tell, but nothing changed.
    source.pending = { changed: { ...demo }, deleted: [] };
    expect(await handler.refresh()).toBe(0);

    // One of them actually differs, alongside a pile that does not.
    source.pending = {
      changed: {
        ...demo,
        'metrics/gross_revenue.md': demo['metrics/gross_revenue.md']!.replace(
          'title: Gross revenue',
          'title: Gross revenue (restated)',
        ),
      },
      deleted: [],
    };
    expect(await handler.refresh()).toBe(1);
    expect(await (await handler(get('/metrics/gross_revenue'))).text()).toContain(
      'Gross revenue (restated)',
    );
  });

  it('applies a deletion the source does report', async () => {
    const source = trackingSource();
    const handler = createBundleHandler({ source });
    await handler.warm();

    source.pending = { changed: {}, deleted: ['metrics/gross_revenue.md'] };
    expect(await handler.refresh()).toBe(1);
    expect((await handler(get('/metrics/gross_revenue'))).status).toBe(404);
  });

  it('reads everything when asked to reconcile', async () => {
    const source = trackingSource();
    const handler = createBundleHandler({ source });
    await handler.warm();

    const remaining = { ...demo };
    delete remaining['metrics/gross_revenue.md'];
    source.files = remaining;
    // The incremental path would report nothing: it cannot see deletions.
    expect(await handler.refresh()).toBe(0);
    expect((await handler(get('/metrics/gross_revenue'))).status).toBe(200);

    expect(await handler.refresh({ full: true })).toBe(1);
    expect(source.fullReads).toBe(2);
    expect((await handler(get('/metrics/gross_revenue'))).status).toBe(404);
  });

  it('carries the cursor forward even when nothing moved', async () => {
    const source = trackingSource();
    const handler = createBundleHandler({ source });
    await handler.warm();

    expect(await handler.refresh()).toBe(0);
    expect(await handler.refresh()).toBe(0);
    expect(source.incrementalReads).toBe(2);
  });

  it('falls back to a full read for a source that cannot say', async () => {
    // memorySource returns no cursor, so there is nothing to resume from.
    const source = memorySource();
    const handler = createBundleHandler({ source });
    await handler.warm();

    await handler.refresh();
    expect(source.loads).toBe(2);
  });
});

describe('HTTP manners', () => {
  it('answers HEAD with the headers but no body', async () => {
    const handler = createBundleHandler({ source: memorySource() });
    const response = await handler(get('/', { method: 'HEAD' }));

    expect(response.status).toBe(200);
    expect(Number(response.headers.get('content-length'))).toBeGreaterThan(0);
    expect(await response.text()).toBe('');
  });

  it('refuses anything that is not a read', async () => {
    const handler = createBundleHandler({ source: memorySource() });
    const response = await handler(get('/', { method: 'POST' }));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});
