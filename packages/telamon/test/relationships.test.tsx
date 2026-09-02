import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OkfSite,
  createMemoryRouter,
  parseBundle,
  referenceRoutes,
  type OkfSiteProps,
} from '../src/index.js';
import { readFixture } from './helpers.js';

const edge = readFixture('edge');
const bundle = parseBundle(edge);

afterEach(cleanup);

function renderSite({ route = '/', ...props }: Partial<OkfSiteProps> & { route?: string } = {}) {
  const router = createMemoryRouter(route);
  render(<OkfSite bundle={edge} router={router} {...props} />);
  return { router };
}

const relationships = () => bundle.byRoute.get('/relationships')!.frontmatter.relationships;
const byType = (type: string) => relationships().filter((r) => r.type === type);

describe('parsing the relationships key', () => {
  it('resolves every target form OKF cross-links use', () => {
    // bundle-absolute
    expect(byType('depends_on')[0]).toMatchObject({
      target: '/loose/thing.md',
      route: '/loose/thing',
      description: 'Reads the loose thing.',
      broken: false,
    });
    // ./relative
    expect(byType('derived_from')[0]).toMatchObject({ route: '/deprecated', broken: false });
    // bare relative
    expect(byType('depends_on')[1]).toMatchObject({ route: '/collide/inner', broken: false });
  });

  it('marks external targets without trying to route them', () => {
    const external = byType('documented_by')[0]!;
    expect(external).toMatchObject({
      target: 'https://example.com/handbook',
      external: true,
      broken: false,
    });
    expect(external.route).toBeUndefined();
  });

  it('reports a target that is not in the bundle instead of throwing', () => {
    const missing = byType('depends_on')[2]!;
    expect(missing.broken).toBe(true);
    expect(missing.route).toBeUndefined();
    const diagnostic = bundle.diagnostics.find((d) => d.code === 'broken-relationship');
    expect(diagnostic?.filePath).toBe('relationships.md');
    expect(diagnostic?.message).toContain('/nowhere-at-all.md');
  });

  it('keeps an entry with a target but no type', () => {
    const untyped = relationships().find((r) => r.type === undefined);
    expect(untyped).toMatchObject({ route: '/loose/thing', broken: false });
  });

  it('reports malformed entries and keeps the rest', () => {
    const malformed = parseBundle({
      'a.md': '---\ntype: X\nrelationships: not-a-list\n---\nA.',
      'b.md': '---\ntype: X\nrelationships:\n  - type: needs\n  - "just a string"\n  - type: uses\n    target: /a.md\n---\nB.',
    });
    const codes = malformed.diagnostics.filter((d) => d.code === 'invalid-relationship');
    expect(codes).toHaveLength(3); // not-a-list, the missing target, the bare string
    // The one good entry on b.md survives.
    expect(malformed.byRoute.get('/b')?.frontmatter.relationships).toMatchObject([
      { type: 'uses', route: '/a' },
    ]);
  });

  it('leaves bundles without the key untouched', () => {
    const ga4 = parseBundle(readFixture('ga4'));
    expect(ga4.docs.every((doc) => doc.frontmatter.relationships.length === 0)).toBe(true);
    expect(ga4.diagnostics).toEqual([]);
  });
});

describe('the link graph', () => {
  const typed = () => bundle.graph.edges.filter((e) => e.directed);

  it('adds a directed, named edge per relationship', () => {
    expect(typed()).toContainEqual({
      source: '/relationships',
      target: '/deprecated',
      type: 'derived_from',
      directed: true,
    });
  });

  it('keeps both directions when two concepts point at each other', () => {
    const between = typed().filter(
      (e) =>
        e.type === 'depends_on' &&
        ((e.source === '/relationships' && e.target === '/loose/thing') ||
          (e.source === '/loose/thing' && e.target === '/relationships')),
    );
    expect(between).toHaveLength(2);
    expect(new Set(between.map((e) => e.source))).toEqual(
      new Set(['/relationships', '/loose/thing']),
    );
  });

  it('leaves body-link edges undirected', () => {
    expect(bundle.graph.edges.some((e) => !e.directed)).toBe(true);
  });

  it('excludes broken and external targets', () => {
    expect(typed().some((e) => e.target.includes('nowhere'))).toBe(false);
    expect(typed().some((e) => e.target.startsWith('http'))).toBe(false);
  });

  it('produces a backlink labelled with the relationship', () => {
    const refs = bundle.backlinks.get('/loose/thing');
    expect(refs).toContainEqual(
      expect.objectContaining({ route: '/relationships', relationship: 'depends_on' }),
    );
  });
});

describe('the concept page', () => {
  it('lists relationships with their type, target, and description', () => {
    renderSite({ route: '/relationships' });
    const section = screen.getByRole('region', { name: 'Relationships' });

    expect(within(section).getAllByText('depends on')).toHaveLength(3);
    expect(within(section).getByText('derived from')).toBeInTheDocument();
    expect(within(section).getByText('Reads the loose thing.')).toBeInTheDocument();
    // Two entries target this file: a typed one and an untyped one.
    const targets = within(section).getAllByRole('link', { name: '/loose/thing.md' });
    expect(targets).toHaveLength(2);
    expect(targets[0]).toHaveAttribute('href', '/loose/thing');
  });

  it('renders an unresolvable target inert, like a broken body link', () => {
    renderSite({ route: '/relationships' });
    const section = screen.getByRole('region', { name: 'Relationships' });
    expect(
      within(section).queryByRole('link', { name: '/nowhere-at-all.md' }),
    ).not.toBeInTheDocument();
    expect(within(section).getByText('/nowhere-at-all.md')).toHaveClass('okf-link--broken');
  });

  it('labels an untyped entry rather than leaving a blank', () => {
    renderSite({ route: '/relationships' });
    const section = screen.getByRole('region', { name: 'Relationships' });
    expect(within(section).getByText('related to')).toBeInTheDocument();
  });

  it('shows nothing for a concept that declares none', () => {
    renderSite({ route: '/draft' });
    expect(screen.queryByRole('region', { name: 'Relationships' })).not.toBeInTheDocument();
  });

  it('is replaceable like any other region', () => {
    renderSite({
      route: '/relationships',
      components: { Relationships: () => <p>custom relationships</p> },
    });
    expect(screen.getByText('custom relationships')).toBeInTheDocument();
  });
});

describe('the demo bundle', () => {
  const demo = parseBundle(readFixture('demo'));

  it('parses clean, since it is what the playground shows first', () => {
    expect(demo.diagnostics).toEqual([]);
  });

  it('declares typed relationships across several kinds', () => {
    const typed = demo.graph.edges.filter((e) => e.directed);
    expect(typed.length).toBeGreaterThan(15);
    expect(new Set(typed.map((e) => e.type))).toEqual(
      new Set([
        'depends_on',
        'derived_from',
        'documented_by',
        'joins_to',
        'produced_by',
        'writes_to',
        'contradicts',
      ]),
    );
  });

  it('points its provenance concepts at a references/ tree the toggle can hide', () => {
    const hidden = referenceRoutes(demo);
    expect([...hidden].sort()).toEqual([
      '/references',
      '/references/analytics_style_guide',
      '/references/finance_handbook',
      '/references/order_schema_rfc',
    ]);
    // Every documented_by edge lands in that tree, so hiding it is a real test
    // of relationships pointing at concepts the sidebar is not showing.
    const documented = demo.graph.edges.filter((e) => e.type === 'documented_by');
    expect(documented.length).toBeGreaterThan(0);
    expect(documented.every((e) => hidden.has(e.target))).toBe(true);
  });
});
