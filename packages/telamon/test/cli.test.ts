// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseServeArgs, UsageError } from '../src/cli/args.js';
import { serve, type RunningServer } from '../src/cli/serve.js';
import { fixturePath } from './helpers.js';

describe('parseServeArgs', () => {
  it('defaults to serving the working directory on 3000', () => {
    expect(parseServeArgs([])).toEqual({
      dir: '.',
      port: 3000,
      host: 'localhost',
      enhance: true,
      open: false,
    });
  });

  it('reads the options it documents', () => {
    expect(parseServeArgs(['./bundle', '-p', '8080', '--host', '0.0.0.0', '--no-script'])).toEqual({
      dir: './bundle',
      port: 8080,
      host: '0.0.0.0',
      enhance: false,
      open: false,
    });
    expect(parseServeArgs(['--basename', '/docs', '--title', 'Acme']).basename).toBe('/docs');
  });

  it('refuses what it cannot make sense of', () => {
    expect(() => parseServeArgs(['--port'])).toThrow(UsageError);
    expect(() => parseServeArgs(['--port', 'eighty'])).toThrow(/port number/);
    expect(() => parseServeArgs(['--nope'])).toThrow(/Unknown option/);
    expect(() => parseServeArgs(['a', 'b'])).toThrow(/Unexpected argument/);
  });
});

/**
 * The server as the CLI actually assembles it.
 *
 * The handler's own tests cannot see this seam: the CLI serves its static files
 * from the same prefix the endpoints live under, and an earlier version
 * answered everything there itself -- so `search.json` and `bundle.zip` came
 * back 404 from a binary whose unit tests all passed.
 */
describe('the server the CLI starts', () => {
  let running: RunningServer | undefined;

  afterEach(async () => {
    await running?.close();
    running = undefined;
    vi.restoreAllMocks();
  });

  async function start() {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Port 0: the OS picks one that is free, so tests never collide.
    running = await serve({
      dir: fixturePath('demo'),
      port: 0,
      host: '127.0.0.1',
      enhance: true,
      open: false,
      title: 'Acme analytics',
    });
    return running.url;
  }

  it('renders a page', async () => {
    const base = await start();
    const response = await fetch(`${base}/metrics/gross_revenue`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<title>Gross revenue · Acme analytics</title>');
    expect(html).toContain('Total charged before refunds');
  });

  it('lets the endpoints through to the handler', async () => {
    const base = await start();

    const search = await fetch(`${base}/_telamon/search.json?q=revenue`);
    expect(search.status).toBe(200);
    const found = (await search.json()) as { results: { route: string }[] };
    expect(found.results.map((r) => r.route)).toContain('/metrics/gross_revenue');

    const zip = await fetch(`${base}/_telamon/bundle.zip`);
    expect(zip.status).toBe(200);
    expect(zip.headers.get('content-disposition')).toContain('acme-analytics.zip');
    expect([...new Uint8Array(await zip.arrayBuffer()).slice(0, 2)]).toEqual([0x50, 0x4b]);
  });

  it('still 404s a path under the prefix that is neither', async () => {
    const base = await start();
    expect((await fetch(`${base}/_telamon/nope.json`)).status).toBe(404);
  });

  it('reports a missing directory before it starts listening', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(
      serve({
        dir: fixturePath('does-not-exist'),
        port: 0,
        host: '127.0.0.1',
        enhance: true,
        open: false,
      }),
    ).rejects.toThrow(/cannot read/);
  });
});
