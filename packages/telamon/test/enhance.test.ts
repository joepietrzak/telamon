/**
 * The enhancement script, against markup the server actually produced.
 *
 * What matters here is the bargain: the page works before this runs, and this
 * upgrades it without fetching a bundle. So each test checks the un-enhanced
 * page first, then what the script adds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enhancePage } from '../src/client.js';
import { createBundleHandler } from '../src/server/index.js';
import type { BundleSource } from '../src/source/index.js';
import { readFixture } from './helpers.js';

const demo = readFixture('demo');
const source: BundleSource = { name: 'memory', load: async () => ({ files: demo, diagnostics: [] }) };

async function serve(route = '/'): Promise<string> {
  const handler = createBundleHandler({ source, title: 'Acme analytics' });
  const html = await (await handler(new Request(`http://localhost${route}`))).text();
  return html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));
}

async function load(route = '/'): Promise<void> {
  document.body.innerHTML = (await serve(route)).replace(
    /<script type="module"[^>]*><\/script>/,
    '',
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the served page before any script runs', () => {
  it('already carries a working search form, download, and toggle', async () => {
    await load('/');

    const form = document.querySelector('form[role="search"]')!;
    expect(form.getAttribute('action')).toBe('/search');
    expect(form.getAttribute('method')).toBe('get');
    expect(document.querySelector('a[href="/_telamon/bundle.zip"]')).not.toBeNull();
    expect(document.querySelector('a.okf-references-toggle')?.getAttribute('href')).toBe(
      '/?references=0',
    );
  });
});

describe('enhancePage', () => {
  it('makes the narrow-screen navigation button work', async () => {
    await load('/');
    const button = document.querySelector<HTMLButtonElement>('.okf-nav-button')!;
    const root = document.querySelector<HTMLElement>('.okf-root')!;

    // Inert until enhanced: the server has no state to toggle.
    button.click();
    expect(root.getAttribute('data-okf-nav-open')).toBeNull();

    enhancePage();
    button.click();
    expect(root.getAttribute('data-okf-nav-open')).toBe('true');
    expect(button.getAttribute('aria-expanded')).toBe('true');

    button.click();
    expect(root.getAttribute('data-okf-nav-open')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('asks the server for results as the reader types', async () => {
    const fetchMock = vi.fn(async (_url: string | URL) =>
      new Response(
        JSON.stringify({
          results: [{ route: '/metrics/gross_revenue', title: 'Gross revenue', type: 'Metric' }],
          hiddenMatches: 0,
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await load('/');
    enhancePage();

    const input = document.querySelector<HTMLInputElement>('[data-okf-search-input]')!;
    input.value = 'revenue';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('/_telamon/search.json?q=revenue');

    await vi.waitFor(() => {
      expect(document.querySelector('.okf-search-panel')?.hasAttribute('hidden')).toBe(false);
    });
    const link = document.querySelector<HTMLAnchorElement>('.okf-search-result-link')!;
    expect(link.textContent).toContain('Gross revenue');
    expect(link.getAttribute('href')).toBe('/metrics/gross_revenue');
  });

  it('leaves the page alone when the endpoint is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    await load('/');
    enhancePage();

    const input = document.querySelector<HTMLInputElement>('[data-okf-search-input]')!;
    input.value = 'revenue';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // The form is still there to submit, which is the whole fallback.
    await vi.waitFor(() => expect(document.querySelector('form[role="search"]')).not.toBeNull());
    expect(document.querySelector('.okf-search-panel')?.hasAttribute('hidden')).toBe(true);
  });

  it('expands a closed directory by fetching that level', async () => {
    const fetchMock = vi.fn(async (_url: string | URL) =>
      new Response(
        JSON.stringify({
          children: [
            { route: '/tables/orders', label: 'orders', kind: 'concept', children: false },
            { route: '/tables/customers', label: 'customers', kind: 'concept', children: false },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    // On a metrics page, so the tables branch arrives closed and empty.
    await load('/metrics/gross_revenue');

    const tables = [...document.querySelectorAll('.okf-nav-item')].find(
      (item) => item.querySelector('.okf-nav-link')?.getAttribute('href') === '/tables',
    )!;
    const toggle = tables.querySelector<HTMLButtonElement>('.okf-nav-toggle')!;

    // The server sent no children for it, which is what keeps the page small.
    expect(tables.querySelector('.okf-nav-list')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    // Inert before enhancement: a reader without JavaScript follows the link.
    toggle.click();
    expect(fetchMock).not.toHaveBeenCalled();

    enhancePage();
    toggle.click();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/_telamon/nav.json?route=%2Ftables');

    await vi.waitFor(() => expect(tables.querySelector('.okf-nav-list')).not.toBeNull());

    // Scoped to the level that was just added: a descendant selector would
    // also match this item's own link, whose ancestors include the root list.
    const level = tables.querySelector(':scope > .okf-nav-list')!;
    const links = [...level.querySelectorAll('.okf-nav-link')];
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/tables/orders',
      '/tables/customers',
    ]);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses and re-opens without fetching the level twice', async () => {
    const fetchMock = vi.fn(async (_url: string | URL) =>
      new Response(
        JSON.stringify({
          children: [{ route: '/tables/orders', label: 'orders', kind: 'concept', children: false }],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await load('/metrics/gross_revenue');
    enhancePage();

    const tables = [...document.querySelectorAll('.okf-nav-item')].find(
      (item) => item.querySelector('.okf-nav-link')?.getAttribute('href') === '/tables',
    )!;
    const toggle = tables.querySelector<HTMLButtonElement>('.okf-nav-toggle')!;

    toggle.click();
    await vi.waitFor(() => expect(tables.querySelector('.okf-nav-list')).not.toBeNull());

    toggle.click();
    expect(tables.querySelector<HTMLElement>('.okf-nav-list')!.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    expect(tables.querySelector<HTMLElement>('.okf-nav-list')!.hidden).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('leaves the branch closed when the level cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

    await load('/metrics/gross_revenue');
    enhancePage();

    const tables = [...document.querySelectorAll('.okf-nav-item')].find(
      (item) => item.querySelector('.okf-nav-link')?.getAttribute('href') === '/tables',
    )!;
    const toggle = tables.querySelector<HTMLButtonElement>('.okf-nav-toggle')!;
    toggle.click();

    await vi.waitFor(() => expect(toggle.hasAttribute('aria-busy')).toBe(false));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // And the label beside it still goes to the page that lists the contents.
    expect(tables.querySelector('.okf-nav-link')?.getAttribute('href')).toBe('/tables');
  });

  it('does nothing at all on a page served without settings', async () => {
    document.body.innerHTML = '<div class="okf-root"></div>';
    expect(() => enhancePage()).not.toThrow();
  });
});
