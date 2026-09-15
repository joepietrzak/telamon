import { describe, expect, it } from 'vitest';
import { parseBundle } from '../src/index.js';
import { isStale, trustTierOf } from '../src/bundle/frontmatter.js';
import { readFixture } from './helpers.js';

const bundle = parseBundle(readFixture('edge'));
const codes = (code: string) => bundle.diagnostics.filter((d) => d.code === code);

describe('leniency (SPEC §11)', () => {
  it('renders a concept missing `type` and reports it instead of rejecting it', () => {
    expect(bundle.byRoute.get('/no-type')?.title).toBe('Untyped concept');
    expect(codes('missing-type').map((d) => d.filePath)).toEqual(['no-type.md']);
  });

  it('keeps unmodeled frontmatter keys verbatim on `raw`', () => {
    const raw = bundle.byRoute.get('/deprecated')?.frontmatter.raw;
    expect(raw?.custom_field).toEqual({ nested: 'kept verbatim' });
  });

  it('reports broken links without throwing', () => {
    expect(codes('broken-link')).toHaveLength(1);
    expect(codes('broken-link')[0]?.message).toContain('does-not-exist.md');
    const draft = bundle.byRoute.get('/draft');
    expect(draft?.links.find((link) => link.route === '/does-not-exist')?.broken).toBe(true);
  });

  it('reports an index entry that points nowhere', () => {
    expect(codes('unresolved-index-entry')[0]?.message).toContain('nowhere.md');
  });
});

describe('routing', () => {
  it('gives the directory index precedence over a same-named file', () => {
    expect(bundle.byRoute.get('/collide')?.filePath).toBe('collide/index.md');
    expect(codes('route-collision')[0]?.message).toContain('collide.md');
  });

  it('routes a directory that has no index.md', () => {
    expect(bundle.byRoute.has('/loose')).toBe(false);
    expect(bundle.directories.get('/loose')?.children.map((child) => child.route)).toEqual([
      '/loose/thing',
    ]);
  });

  it('resolves all three link forms', () => {
    const routes = bundle.byRoute.get('/draft')?.links.map((link) => link.route);
    expect(routes).toContain('/loose/thing'); // bundle-absolute
    expect(routes).toContain('/no-type'); // ./relative
    expect(bundle.byRoute.get('/loose/thing')?.links.map((l) => l.route)).toContain('/draft'); // ../
  });

  it('ignores external, anchor, and asset links when building the graph', () => {
    const routes = bundle.byRoute.get('/draft')?.links.map((link) => link.route) ?? [];
    expect(routes).not.toContain('/diagram.png');
    expect(routes.some((route) => route.includes('example.com'))).toBe(false);
  });

  it('routes log.md alongside its directory', () => {
    expect(bundle.byRoute.get('/log')?.kind).toBe('log');
  });

  /**
   * A bundle is keyed by the characters in its filenames; a markdown renderer
   * percent-encodes every href it emits. Without a decode in between, a link to
   * any filename outside ASCII resolves to a file nobody has -- which is a
   * broken link on an entirely intact bundle.
   */
  it('resolves links to filenames outside ASCII', () => {
    for (const name of ['café', 'エネルギー', 'المسيحية', 'विज्ञान', 'Наука']) {
      const local = parseBundle({
        'a.md': `---\ntype: Article\ntitle: A\n---\n\n[x](${name}.md)\n`,
        [`${name}.md`]: `---\ntype: Article\ntitle: T\n---\n\nBody.\n`,
      });
      const link = local.byPath.get('a.md')?.links[0];
      expect(link, name).toMatchObject({ route: `/${name}`, broken: false });
      expect(local.backlinks.get(`/${name}`), name).toHaveLength(1);
      expect(local.diagnostics.filter((d) => d.code === 'broken-link'), name).toHaveLength(0);
    }
  });

  it('leaves a href it cannot decode as it found it', () => {
    // A stray `%` is a filename, not an encoding error worth failing a link over.
    const local = parseBundle({
      'a.md': '---\ntype: Article\ntitle: A\n---\n\n[x](100%-done.md)\n',
      '100%-done.md': '---\ntype: Article\ntitle: T\n---\n\nBody.\n',
    });
    expect(local.byPath.get('a.md')?.links[0]).toMatchObject({ broken: false });
  });
});

describe('lifecycle and trust', () => {
  it('defaults status to stable and reads draft/deprecated', () => {
    expect(bundle.byRoute.get('/no-type')?.frontmatter.status).toBe('stable');
    expect(bundle.byRoute.get('/draft')?.frontmatter.status).toBe('draft');
    expect(bundle.byRoute.get('/deprecated')?.frontmatter.status).toBe('deprecated');
  });

  it('treats a bare `verified` mapping as a one-element list', () => {
    const frontmatter = bundle.byRoute.get('/deprecated')!.frontmatter;
    expect(frontmatter.verified).toHaveLength(1);
    expect(frontmatter.verified[0]?.by).toMatchObject({ kind: 'human', id: 'ada' });
    expect(trustTierOf(frontmatter)).toBe('human-reviewed');
  });

  it('derives machine-confirmed when no human verified', () => {
    const frontmatter = bundle.byRoute.get('/verified-list')!.frontmatter;
    expect(frontmatter.verified).toHaveLength(2);
    expect(trustTierOf(frontmatter)).toBe('machine-confirmed');
    expect(trustTierOf(bundle.byRoute.get('/draft')!.frontmatter)).toBe('unverified');
  });

  it('computes staleness against an injected clock', () => {
    const frontmatter = bundle.byRoute.get('/deprecated')!.frontmatter;
    expect(isStale(frontmatter, new Date('2026-01-01'))).toBe(true);
    expect(isStale(frontmatter, new Date('2019-01-01'))).toBe(false);
    expect(isStale(bundle.byRoute.get('/draft')!.frontmatter, new Date('2026-01-01'))).toBe(false);
  });

  it('normalizes sources, usage windows, and a single-string tag', () => {
    const frontmatter = bundle.byRoute.get('/verified-list')!.frontmatter;
    expect(frontmatter.usageWindow).toEqual({ from: '2026-01-01', to: '2026-06-30' });
    expect(frontmatter.sourcesById.get('handbook')).toMatchObject({
      author: 'human:grace',
      usageCount: 42,
      lastModified: '2026-04-01',
    });
    expect(bundle.byRoute.get('/draft')?.frontmatter.tags).toEqual(['work-in-progress']);
  });
});

describe('bundle root', () => {
  it('reads okf_version from the root index only, without flagging its frontmatter', () => {
    expect(bundle.okfVersion).toBe('0.2');
    expect(codes('unsupported-okf-version')).toHaveLength(0);
    expect(codes('frontmatter-on-reserved-file')).toHaveLength(0);
  });
});
