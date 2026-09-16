/**
 * The snippets in `docs/three-roads.md`.
 *
 * The guide is what a reader copies before they have any feel for the library,
 * so the shapes it shows have to be the shapes that exist. Each test here
 * mirrors one snippet.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseBundle } from '../src/index.js';
import { DEFAULT_MANIFEST_ID, okfBudget, okfManifest } from '../src/vite/index.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'three-roads-'));
  await mkdir(join(dir, 'tables'), { recursive: true });
  await writeFile(join(dir, 'index.md'), '# Subdirectories\n\n* [tables](tables/index.md) - Our tables.\n');
  await writeFile(join(dir, 'tables', 'index.md'), '# Tables\n\n* [Events](events_.md) - Event export.\n');
  await writeFile(
    join(dir, 'tables', 'events_.md'),
    '---\ntype: BigQuery Table\ntitle: Events\n---\n\nOne row per event.\n',
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Road 1: ship the corpus', () => {
  it('turns glob keys into the bundle-relative paths OkfSite takes', () => {
    // The snippet's prefix arithmetic, on the shape `import.meta.glob` returns.
    const modules = {
      '../bundle/index.md': '# Root\n\n* [tables](tables/index.md) - Our tables.\n',
      '../bundle/tables/index.md': '# Tables\n\n* [Events](events_.md) - Event export.\n',
      '../bundle/tables/events_.md': '---\ntype: BigQuery Table\ntitle: Events\n---\n\nOne row.\n',
    };
    const BUNDLE = Object.fromEntries(
      Object.entries(modules).map(([path, text]) => [path.slice('../bundle/'.length), text]),
    );

    expect(Object.keys(BUNDLE)).toEqual(['index.md', 'tables/index.md', 'tables/events_.md']);
    const bundle = parseBundle(BUNDLE);
    expect(bundle.diagnostics).toEqual([]);
    expect([...bundle.byRoute.keys()]).toContain('/tables/events_');
  });
});

describe('Road 2: ship an index', () => {
  /**
   * The guide writes `okfManifest({ dir: './bundle' })`, which is what a reader
   * will copy. A plugin that only accepted absolute paths would send them to
   * `fileURLToPath` before they had any reason to know why.
   */
  it('accepts the relative dir the guide shows', async () => {
    const plugin = okfManifest({ dir: relative(process.cwd(), dir) });
    const id = plugin.resolveId(DEFAULT_MANIFEST_ID)!;
    const code = await plugin.load.call({}, id);

    expect(code).toContain('export const MANIFEST =');
    expect(code).toContain('export const BODIES =');
    expect(code).toContain('"tables/events_.md"');
  });

  it('produces a manifest that is a navigable bundle without any body', async () => {
    const plugin = okfManifest({ dir });
    const code = await plugin.load.call({}, plugin.resolveId(DEFAULT_MANIFEST_ID)!);
    const manifest = JSON.parse(
      /export const MANIFEST = (\{.*?\});\n/s.exec(code!)![1]!,
    ) as Record<string, string>;

    const bundle = parseBundle(manifest);
    // Every route, drawn before a body has been fetched -- the claim the whole
    // road rests on.
    expect([...bundle.byRoute.keys()].sort()).toEqual(['/', '/tables', '/tables/events_']);
    expect(bundle.byRoute.get('/tables/events_')?.title).toBe('Events');
    expect(manifest['tables/events_.md']).not.toContain('One row per event.');
  });
});

describe('the budget the guide tells both roads to add', () => {
  it('reads the size format the guide writes', () => {
    expect(() => okfBudget({ max: '1 MB' })).not.toThrow();
  });

  it('passes a split build and fails an inlined one', () => {
    // Real entropy: a repeated character gzips to nothing and the budget,
    // which measures the wire by default, would never trip.
    const corpus = randomBytes(2_000_000).toString('base64');
    const run = (output: Parameters<ReturnType<typeof okfBudget>['generateBundle']>[1]) =>
      okfBudget({ max: '1 MB' }).generateBundle.call({}, {}, output);

    // Road 2: the corpus is behind dynamic imports and is not a first load.
    expect(() =>
      run({
        'entry.js': { type: 'chunk', fileName: 'entry.js', code: 'small', isEntry: true, imports: [], dynamicImports: ['body.js'] },
        'body.js': { type: 'chunk', fileName: 'body.js', code: corpus, isEntry: false, imports: [], dynamicImports: [] },
      }),
    ).not.toThrow();

    // Road 1, outgrown: the same bytes, inlined.
    expect(() =>
      run({
        'entry.js': { type: 'chunk', fileName: 'entry.js', code: corpus, isEntry: true, imports: [], dynamicImports: [] },
      }),
    ).toThrow(/over the 1.00 MB budget/);
  });
});
