import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import {
  OkfSite,
  classifyHref,
  createMemoryRouter,
  filePathToRoute,
  hrefToRoute,
  parseBundle,
  routeToHref,
} from '../src/index.js';
import { readFixture } from './helpers.js';

const ga4 = readFixture('ga4');
const edge = readFixture('edge');

afterEach(cleanup);

describe('route coverage', () => {
  it.each([
    ['ga4', ga4],
    ['edge', edge],
  ])('routes every markdown file in the %s bundle to a resolvable page', (_name, files) => {
    const bundle = parseBundle(files);
    const collisions = new Set(
      bundle.diagnostics.filter((d) => d.code === 'route-collision').map((d) => d.filePath),
    );

    for (const doc of bundle.docs) {
      if (collisions.has(doc.filePath)) continue;
      expect(
        bundle.byRoute.get(doc.route)?.filePath,
        `${doc.filePath} should own ${doc.route}`,
      ).toBe(doc.filePath);
    }

    // Every route is unique, and every one round-trips through an href.
    const routes = bundle.docs.map((doc) => doc.route);
    expect(new Set(routes).size).toBe(routes.length - collisions.size);
    for (const route of new Set(routes)) {
      expect(hrefToRoute(routeToHref(route))).toBe(route);
    }
  });

  it.each([
    ['ga4', ga4],
    ['edge', edge],
  ])('resolves or reports every in-bundle link in the %s bundle', (_name, files) => {
    const bundle = parseBundle(files);
    const reported = new Set(
      bundle.diagnostics
        .filter((d) => d.code === 'broken-link' || d.code === 'unresolved-index-entry')
        .map((d) => d.filePath),
    );

    for (const doc of bundle.docs) {
      for (const link of doc.links) {
        if (link.broken) {
          expect(reported.has(doc.filePath), `${doc.filePath} -> ${link.route}`).toBe(true);
          continue;
        }
        expect(
          bundle.byRoute.has(link.route) || bundle.directories.has(link.route),
          `${doc.filePath} links to ${link.route}`,
        ).toBe(true);
      }
    }
  });
});

describe('path arithmetic', () => {
  it('maps file paths to routes', () => {
    expect(filePathToRoute('index.md')).toBe('/');
    expect(filePathToRoute('tables/index.md')).toBe('/tables');
    expect(filePathToRoute('tables/events_.md')).toBe('/tables/events_');
    expect(filePathToRoute('./a/../b/c.md')).toBe('/b/c');
  });

  it('classifies the link forms OKF bundles use', () => {
    expect(classifyHref('/tables/events_.md', 'references/metrics')).toMatchObject({
      kind: 'document',
      route: '/tables/events_',
    });
    expect(classifyHref('../references/metrics/purchasers.md', 'tables')).toMatchObject({
      kind: 'document',
      route: '/references/metrics/purchasers',
    });
    expect(classifyHref('events_.md', 'tables')).toMatchObject({ kind: 'document' });
    expect(classifyHref('x.md#schema', 'tables')).toMatchObject({ fragment: 'schema' });
    expect(classifyHref('https://example.com', 'tables')).toMatchObject({ kind: 'external' });
    expect(classifyHref('mailto:a@b.c', '')).toMatchObject({ kind: 'external' });
    expect(classifyHref('#schema', 'tables')).toMatchObject({ kind: 'anchor' });
    expect(classifyHref('viz.html', 'tables')).toMatchObject({ kind: 'asset', path: 'tables/viz.html' });
  });

  it('round-trips routes with characters that need encoding', () => {
    const route = '/tables/a b/c+d';
    const href = routeToHref(route);
    expect(href).toBe('/tables/a%20b/c%2Bd');
    expect(hrefToRoute(href)).toBe(route);
  });

  it('applies a basename in both directions', () => {
    expect(routeToHref('/tables/events_', '/docs')).toBe('/docs/tables/events_');
    expect(routeToHref('/', '/docs')).toBe('/docs');
    expect(hrefToRoute('/docs/tables', '/docs')).toBe('/tables');
    expect(hrefToRoute('/docs', '/docs')).toBe('/');
    // A path outside the basename is not ours to route.
    expect(hrefToRoute('/other/page', '/docs')).toBeNull();
  });
});

describe('history router', () => {
  it('writes basename-prefixed hrefs and navigates on click', async () => {
    const user = userEvent.setup();
    render(<OkfSite bundle={ga4} basename="/docs" />);

    const link = within(screen.getByRole('navigation', { name: 'Bundle contents' })).getByRole(
      'link',
      { name: 'tables' },
    );
    expect(link).toHaveAttribute('href', '/docs/tables');

    await user.click(link);
    expect(window.location.pathname).toBe('/docs/tables');
    expect(screen.getByRole('heading', { level: 1, name: 'tables' })).toBeInTheDocument();

    window.history.back();
  });
});

describe('memory router', () => {
  it('records history and supports replace', () => {
    const router = createMemoryRouter('/a');
    router.navigate('/b');
    router.navigate('/c', { replace: true });
    expect(router.current).toBe('/c');
    expect(router.entries).toEqual(['/a', '/c']);
  });
});
