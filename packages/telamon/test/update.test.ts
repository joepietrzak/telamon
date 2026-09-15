// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { diffFiles, parseBundle, updateBundle } from '../src/index.js';
import { readFixture } from './helpers.js';

const demo = readFixture('demo');

/**
 * An updated bundle has to be indistinguishable from one parsed from scratch.
 * Anything less and a refreshed server drifts from a restarted one, which is
 * the sort of difference nobody finds until it matters.
 */
function expectSameAsFullParse(actual: ReturnType<typeof parseBundle>, files: Record<string, string>) {
  const expected = parseBundle(files);

  expect([...actual.byRoute.keys()].sort()).toEqual([...expected.byRoute.keys()].sort());
  expect([...actual.byPath.keys()].sort()).toEqual([...expected.byPath.keys()].sort());
  expect(actual.files).toEqual(expected.files);
  expect(actual.okfVersion).toBe(expected.okfVersion);
  expect(actual.root?.filePath).toBe(expected.root?.filePath);

  const nav = (bundle: typeof actual) =>
    JSON.stringify(bundle.tree, (key, value) => (key === 'doc' ? undefined : value));
  expect(nav(actual)).toBe(nav(expected));

  const links = (bundle: typeof actual) =>
    bundle.docs.map((doc) => [doc.filePath, doc.title, doc.links, doc.frontmatter.relationships]);
  expect(links(actual)).toEqual(links(expected));

  const backlinks = (bundle: typeof actual) =>
    [...bundle.backlinks.entries()].sort(([a], [b]) => a.localeCompare(b));
  expect(backlinks(actual)).toEqual(backlinks(expected));

  expect(actual.graph.nodes).toEqual(expected.graph.nodes);
  expect(actual.graph.edges).toEqual(expected.graph.edges);

  const sorted = (list: typeof actual.diagnostics) =>
    [...list].sort((a, b) => `${a.code}${a.filePath}${a.message}`.localeCompare(`${b.code}${b.filePath}${b.message}`));
  expect(sorted(actual.diagnostics)).toEqual(sorted(expected.diagnostics));
}

describe('updateBundle', () => {
  it('produces what a full parse would, for an edited document', () => {
    const before = parseBundle(demo);
    const edited = {
      ...demo,
      'metrics/gross_revenue.md': demo['metrics/gross_revenue.md']!.replace(
        'title: Gross revenue',
        'title: Gross revenue (restated)',
      ),
    };

    const updated = updateBundle(before, { changed: { 'metrics/gross_revenue.md': edited['metrics/gross_revenue.md']! } });

    expect(updated.byRoute.get('/metrics/gross_revenue')!.title).toBe('Gross revenue (restated)');
    expectSameAsFullParse(updated, edited);
  });

  it('leaves the bundle it was given untouched', () => {
    const before = parseBundle(demo);
    const title = before.byRoute.get('/metrics/gross_revenue')!.title;

    updateBundle(before, {
      changed: {
        'metrics/gross_revenue.md': demo['metrics/gross_revenue.md']!.replace(
          'title: Gross revenue',
          'title: Something else',
        ),
      },
    });

    // Anything still rendering from the old bundle keeps rendering the old one.
    expect(before.byRoute.get('/metrics/gross_revenue')!.title).toBe(title);
  });

  it('adds a document, and un-breaks the links that pointed at it', () => {
    const withoutTarget = { ...demo };
    delete withoutTarget['tables/orders.md'];

    const before = parseBundle(withoutTarget);
    // The pipeline's body links to orders, which is not there yet.
    const stale = before.byRoute.get('/pipelines/nightly_orders_load')!;
    expect(stale.links.find((l) => l.route === '/tables/orders')?.broken).toBe(true);
    expect(before.backlinks.get('/tables/orders')).toBeUndefined();

    const after = updateBundle(before, { changed: { 'tables/orders.md': demo['tables/orders.md']! } });

    // The document that links to it was never re-parsed, and is correct anyway.
    const fixed = after.byRoute.get('/pipelines/nightly_orders_load')!;
    expect(fixed.links.find((l) => l.route === '/tables/orders')?.broken).toBe(false);
    expect(after.backlinks.get('/tables/orders')?.map((r) => r.route)).toContain(
      '/pipelines/nightly_orders_load',
    );
    expect(after.diagnostics.filter((d) => d.code === 'broken-link')).toEqual([]);
    expectSameAsFullParse(after, demo);
  });

  it('deletes a document, and breaks the links that pointed at it', () => {
    const before = parseBundle(demo);
    const after = updateBundle(before, { deleted: ['tables/orders.md'] });

    const orphaned = after.byRoute.get('/pipelines/nightly_orders_load')!;
    expect(orphaned.links.find((l) => l.route === '/tables/orders')?.broken).toBe(true);
    expect(after.byRoute.has('/tables/orders')).toBe(false);
    expect(after.diagnostics.some((d) => d.code === 'broken-link')).toBe(true);

    const remaining = { ...demo };
    delete remaining['tables/orders.md'];
    expectSameAsFullParse(after, remaining);
  });

  it('re-resolves typed relationships across a deletion', () => {
    const before = parseBundle(demo);
    const depends = before.byRoute
      .get('/metrics/gross_revenue')!
      .frontmatter.relationships.find((r) => r.target === '/tables/orders.md')!;
    expect(depends.broken).toBe(false);

    const after = updateBundle(before, { deleted: ['tables/orders.md'] });
    const broken = after.byRoute
      .get('/metrics/gross_revenue')!
      .frontmatter.relationships.find((r) => r.target === '/tables/orders.md')!;

    expect(broken.broken).toBe(true);
    expect(after.diagnostics.some((d) => d.code === 'broken-relationship')).toBe(true);
  });

  it('drops a document’s own diagnostics when it is deleted', () => {
    const withProblem = { ...demo, 'metrics/untyped.md': '# No type in frontmatter\n' };
    const before = parseBundle(withProblem);
    expect(before.diagnostics.some((d) => d.code === 'missing-type')).toBe(true);

    const after = updateBundle(before, { deleted: ['metrics/untyped.md'] });
    expect(after.diagnostics.some((d) => d.code === 'missing-type')).toBe(false);
  });

  it('replaces a document’s own diagnostics when it is edited', () => {
    const before = parseBundle({ ...demo, 'metrics/untyped.md': '# No type\n' });
    expect(before.diagnostics.filter((d) => d.code === 'missing-type')).toHaveLength(1);

    const fixed = '---\ntype: Metric\ntitle: Now typed\n---\n\nBody.\n';
    const after = updateBundle(before, { changed: { 'metrics/untyped.md': fixed } });

    expect(after.diagnostics.filter((d) => d.code === 'missing-type')).toHaveLength(0);
    expect(after.byRoute.get('/metrics/untyped')!.title).toBe('Now typed');
  });

  it('notices a route collision appearing and clearing', () => {
    const before = parseBundle(demo);
    expect(before.diagnostics.some((d) => d.code === 'route-collision')).toBe(false);

    // `metrics.md` collides with `metrics/index.md`.
    const collided = updateBundle(before, {
      changed: { 'metrics.md': '---\ntype: Metric\ntitle: Clash\n---\n\nBody.\n' },
    });
    expect(collided.diagnostics.some((d) => d.code === 'route-collision')).toBe(true);

    const cleared = updateBundle(collided, { deleted: ['metrics.md'] });
    expect(cleared.diagnostics.some((d) => d.code === 'route-collision')).toBe(false);
  });

  it('reorders navigation when an index changes', () => {
    const before = parseBundle(demo);
    const order = (bundle: typeof before) =>
      bundle.tree.find((n) => n.route === '/metrics')!.children.map((c) => c.route);

    const reversed = demo['metrics/index.md']!.split('\n').reverse().join('\n');
    const after = updateBundle(before, { changed: { 'metrics/index.md': reversed } });

    expect(order(after)).not.toEqual(order(before));
    expectSameAsFullParse(after, { ...demo, 'metrics/index.md': reversed });
  });

  it('ignores a file reported as changed whose contents are the same', () => {
    const before = parseBundle(demo);
    const after = updateBundle(before, { changed: { ...demo } });

    // Nothing differs, so every document is reused rather than re-parsed --
    // and the syntax trees prove it, being the very same objects.
    for (const doc of after.docs) {
      expect(doc.hast).toBe(before.byPath.get(doc.filePath)!.hast);
    }
    expectSameAsFullParse(after, demo);
  });

  it('keeps the graph object when the graph has not changed', () => {
    const before = parseBundle(demo);

    // An edit that touches no link and no title leaves the graph identical.
    const edited = demo['metrics/gross_revenue.md']!.replace(
      'Sums `gross_amount`',
      'Sums the `gross_amount` column',
    );
    const after = updateBundle(before, { changed: { 'metrics/gross_revenue.md': edited } });

    // Identity, not equality: the settled force layout is cached against it,
    // and re-settling costs more than the whole update.
    expect(after.graph).toBe(before.graph);
  });

  it('builds a new graph object when the graph has changed', () => {
    const before = parseBundle(demo);
    const after = updateBundle(before, { deleted: ['tables/orders.md'] });
    expect(after.graph).not.toBe(before.graph);
  });
});

describe('diffFiles', () => {
  it('reports what a fresh read changed', () => {
    const current: Record<string, string> = {
      ...demo,
      'metrics/new.md': '---\ntype: Metric\n---\n\nNew.\n',
    };
    delete current['tables/orders.md'];
    current['metrics/index.md'] = `${demo['metrics/index.md']!}\n* [New](new.md)\n`;

    const changes = diffFiles(demo, current);

    expect(Object.keys(changes.changed ?? {}).sort()).toEqual([
      'metrics/index.md',
      'metrics/new.md',
    ]);
    expect(changes.deleted).toEqual(['tables/orders.md']);
  });

  it('reports nothing when nothing changed', () => {
    expect(diffFiles(demo, { ...demo })).toEqual({ changed: {} });
  });
});

describe('what it costs', () => {
  function corpus(count: number): Record<string, string> {
    const files: Record<string, string> = { 'index.md': '# Root\n' };
    for (let i = 0; i < count; i += 1) {
      files[`metrics/g${Math.floor(i / 40)}/metric_${i}.md`] =
        `---\ntype: Metric\ntitle: Metric ${i}\n---\n\n${'Prose. '.repeat(40)}\n\n` +
        `See [metric ${(i + 1) % count}](metric_${(i + 1) % count}.md).\n`;
    }
    return files;
  }

  it('costs a fraction of a full parse for a handful of changes', () => {
    const files = corpus(600);
    const bundle = parseBundle(files);

    const fullStarted = performance.now();
    parseBundle(files);
    const fullMs = performance.now() - fullStarted;

    const changed = Object.fromEntries(
      Object.entries(files)
        .slice(0, 5)
        .map(([path, contents]) => [path, `${contents}\nEdited.\n`]),
    );

    const updateStarted = performance.now();
    updateBundle(bundle, { changed });
    const updateMs = performance.now() - updateStarted;

    // Timing, because the whole point is elapsed work rather than output --
    // the output is asserted to be identical elsewhere in this file. The real
    // margin is far wider; three is enough to catch the reuse going away.
    expect(updateMs * 3).toBeLessThan(fullMs);
  });
});
