import { describe, expect, it } from 'vitest';
import { parseBundle } from '../src/index.js';
import { readFixture } from './helpers.js';

const ga4 = readFixture('ga4');

describe('parseBundle on the reference GA4 bundle', () => {
  const bundle = parseBundle(ga4);

  it('parses every markdown file', () => {
    expect(bundle.docs).toHaveLength(Object.keys(ga4).length);
  });

  it('derives routes from the directory structure', () => {
    expect(bundle.byRoute.get('/')?.filePath).toBe('index.md');
    expect(bundle.byRoute.get('/tables')?.filePath).toBe('tables/index.md');
    expect(bundle.byRoute.get('/tables/events_')?.filePath).toBe('tables/events_.md');
    expect(bundle.byRoute.get('/references/metrics/purchasers')?.filePath).toBe(
      'references/metrics/purchasers.md',
    );
  });

  it('reports no diagnostics for a conformant bundle', () => {
    expect(bundle.diagnostics).toEqual([]);
  });

  it('normalizes frontmatter', () => {
    const doc = bundle.byRoute.get('/references/metrics/purchasers');
    expect(doc?.frontmatter.type).toBe('Reference');
    expect(doc?.frontmatter.title).toBe('Purchasers Audience Metric');
    expect(doc?.frontmatter.tags).toContain('purchasers');
    expect(doc?.frontmatter.status).toBe('stable');
    expect(doc?.frontmatter.generated?.by).toMatchObject({
      kind: 'agent',
      id: 'reference_agent',
      version: 'gemini-3.5-flash',
    });
    expect(doc?.frontmatter.sourcesById.get('sample_queries')?.title).toContain('Sample queries');
  });

  it('reads index.md order and descriptions', () => {
    const root = bundle.root;
    expect(root?.entries.map((entry) => entry.route)).toEqual([
      '/datasets',
      '/references',
      '/tables',
    ]);
    expect(root?.entries[0]?.description).toContain('Obfuscated Google Analytics 4 dataset');
  });

  it('builds a nav tree ordered by the index files', () => {
    expect(bundle.tree.map((node) => node.route)).toEqual(['/datasets', '/references', '/tables']);
    const metrics = bundle.tree.find((node) => node.route === '/references')?.children[0];
    expect(metrics?.route).toBe('/references/metrics');
    expect(metrics?.children[0]?.label).toBe('Acquired Users Metric');
  });

  it('resolves relative cross-links into backlinks', () => {
    const events = bundle.byRoute.get('/tables/events_');
    expect(events?.links.some((link) => link.route === '/references/metrics/purchasers')).toBe(true);
    expect(
      bundle.backlinks.get('/references/metrics/purchasers')?.map((ref) => ref.route),
    ).toContain('/tables/events_');
  });

  it('collects headings for the table of contents', () => {
    const events = bundle.byRoute.get('/tables/events_');
    expect(events?.headings.map((heading) => heading.text)).toContain('Schema');
  });
});
