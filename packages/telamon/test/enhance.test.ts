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

  it('does nothing at all on a page served without settings', async () => {
    document.body.innerHTML = '<div class="okf-root"></div>';
    expect(() => enhancePage()).not.toThrow();
  });
});
