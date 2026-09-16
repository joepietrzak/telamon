/**
 * The build-time half of the lazy bundle.
 *
 * What matters is the split: the manifest has to be a complete bundle minus
 * prose -- every route, title, type and link -- because the navigation tree,
 * the graph and backlinks are built from it before any body has arrived.
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseBundle } from '../src/index.js';
import { DEFAULT_MANIFEST_ID, manifestEntry, okfManifest } from '../src/vite/index.js';

let dir: string;

const doc = (title: string, body: string, extra = '') =>
  `---\ntype: Concept\ntitle: ${title}\ndescription: About ${title}.\n${extra}---\n\n${body}\n`;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'okf-manifest-'));
  await mkdir(join(dir, 'metrics'), { recursive: true });
  await writeFile(join(dir, 'index.md'), '# Root\n\n- [Metrics](metrics/index.md)\n');
  await writeFile(join(dir, 'metrics', 'index.md'), '# Metrics\n\n- [Revenue](revenue.md)\n');
  await writeFile(
    join(dir, 'metrics', 'revenue.md'),
    doc('Revenue', 'Prose nobody needs to draw a tree.', 'relationships:\n  - type: uses\n    target: orders.md\n'),
  );
  await writeFile(join(dir, 'metrics', 'orders.md'), doc('Orders', 'More prose.'));
  await writeFile(join(dir, 'notes.txt'), 'not markdown');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Run the plugin's `load` the way Vite would. */
async function loadManifest(plugin: ReturnType<typeof okfManifest>) {
  const watched: string[] = [];
  const id = plugin.resolveId(DEFAULT_MANIFEST_ID)!;
  const code = await plugin.load.call({ addWatchFile: (f: string) => watched.push(f) }, id);
  const manifest = JSON.parse(/export const MANIFEST = (\{.*?\});\n/s.exec(code!)![1]!) as Record<string, string>;
  const bodyKeys = [...code!.matchAll(/^ {2}"([^"]+)": \(\) => import\(/gm)].map((m) => m[1]!);
  return { code: code!, manifest, bodyKeys, watched };
}

describe('manifestEntry', () => {
  it('keeps frontmatter and drops prose', () => {
    expect(manifestEntry('a.md', doc('A', 'Body text.'))).toBe(
      '---\ntype: Concept\ntitle: A\ndescription: About A.\n---',
    );
  });

  it('keeps a reserved file whole, because its body is the navigation', () => {
    const index = '# Metrics\n\n- [Revenue](revenue.md)\n';
    expect(manifestEntry('metrics/index.md', index)).toBe(index);
    expect(manifestEntry('log.md', '# Log\n\nEntries.\n')).toBe('# Log\n\nEntries.\n');
  });

  it('returns nothing for a document with no frontmatter to keep', () => {
    expect(manifestEntry('a.md', 'Just prose.\n')).toBe('');
  });
});

describe('okfManifest', () => {
  it('serves only its own module id', () => {
    const plugin = okfManifest({ dir });
    expect(plugin.resolveId(DEFAULT_MANIFEST_ID)).toBe(`\0${DEFAULT_MANIFEST_ID}`);
    expect(plugin.resolveId('react')).toBeUndefined();
  });

  it('takes a custom id when the default would collide', async () => {
    const plugin = okfManifest({ dir, id: 'virtual:my-docs' });
    expect(plugin.resolveId('virtual:my-docs')).toBe('\0virtual:my-docs');
    expect(plugin.resolveId(DEFAULT_MANIFEST_ID)).toBeUndefined();
  });

  it('emits every markdown file and nothing else', async () => {
    const { manifest, bodyKeys, watched } = await loadManifest(okfManifest({ dir }));
    const paths = Object.keys(manifest).sort();
    expect(paths).toEqual(['index.md', 'metrics/index.md', 'metrics/orders.md', 'metrics/revenue.md']);
    expect(bodyKeys.sort()).toEqual(paths);
    // `vite build --watch` reruns on an input it was told about.
    expect(watched).toHaveLength(4);
  });

  it('produces a bundle that is complete apart from prose', async () => {
    const { manifest } = await loadManifest(okfManifest({ dir }));
    const bundle = parseBundle(manifest);

    // Every route, and the tree that is drawn before a body exists.
    expect([...bundle.byRoute.keys()].sort()).toEqual(['/', '/metrics', '/metrics/orders', '/metrics/revenue']);
    expect(bundle.byRoute.get('/metrics/revenue')?.title).toBe('Revenue');
    expect(bundle.tree.map((n) => n.route)).toEqual(['/metrics']);

    // The graph is whole: typed relationships come from frontmatter, and the
    // index links come from reserved files, which travel intact.
    expect(bundle.graph.edges.map((e) => [e.source, e.target, e.type ?? null]).sort()).toEqual([
      ['/', '/metrics', null],
      ['/metrics', '/metrics/revenue', null],
      ['/metrics/revenue', '/metrics/orders', 'uses'],
    ]);
    expect(bundle.backlinks.get('/metrics/orders')).toHaveLength(1);

    // And the prose is genuinely absent -- that is the entire point.
    expect(manifest['metrics/revenue.md']).not.toContain('Prose nobody needs');
    // Dropping bodies must not drop the links inside them into nowhere: every
    // link in this bundle lives in frontmatter or a reserved file, so nothing
    // should come back broken.
    expect(
      bundle.diagnostics.filter((d) => d.code === 'broken-link' || d.code === 'broken-relationship'),
    ).toEqual([]);
  });

  it('invalidates and reloads when a document changes', () => {
    const handlers: Record<string, (path: string) => void> = {};
    const invalidated: string[] = [];
    const sent: string[] = [];
    const module = { id: `\0${DEFAULT_MANIFEST_ID}` };

    okfManifest({ dir }).configureServer({
      watcher: { add: () => {}, on: (event, handler) => (handlers[event] = handler) },
      moduleGraph: {
        getModuleById: (id) => (id === module.id ? module : undefined),
        invalidateModule: (m) => invalidated.push(m.id!),
      },
      ws: { send: (payload) => sent.push(payload.type) },
    });

    handlers['change']!(join(dir, 'metrics', 'revenue.md'));
    expect(invalidated).toEqual([`\0${DEFAULT_MANIFEST_ID}`]);
    expect(sent).toEqual(['full-reload']);

    // Not every file on disk is the bundle.
    handlers['change']!(join(dir, 'notes.txt'));
    handlers['change']!('/somewhere/else/other.md');
    expect(sent).toHaveLength(1);
  });
});
