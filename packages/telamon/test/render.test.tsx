import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { OkfSite, createMemoryRouter, parseBundle, type OkfSiteProps } from '../src/index.js';
import { readFixture } from './helpers.js';

const ga4 = readFixture('ga4');
const edge = readFixture('edge');

afterEach(cleanup);

function renderSite(
  files: Record<string, string>,
  { route = '/', ...props }: Partial<OkfSiteProps> & { route?: string } = {},
) {
  const router = createMemoryRouter(route);
  const result = render(<OkfSite bundle={files} router={router} {...props} />);
  return { ...result, router, user: userEvent.setup() };
}

describe('concept pages', () => {
  it('renders frontmatter chrome and the markdown body', () => {
    renderSite(ga4, { route: '/references/metrics/purchasers' });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Purchasers Audience Metric' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Computes the count or list of users/)).toBeInTheDocument();
    expect(screen.getByText('Reference', { selector: '.okf-badge--type' })).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    expect(screen.getByText('purchasers')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Common query patterns/ })).toBeInTheDocument();
    expect(screen.getByText(/COUNT\(DISTINCT user_id\)/)).toBeInTheDocument();
  });

  it('lists frontmatter sources', () => {
    renderSite(ga4, { route: '/references/metrics/purchasers' });
    const sources = screen.getByRole('region', { name: 'Sources' });
    expect(
      within(sources).getByRole('link', { name: /Sample queries for audiences/ }),
    ).toHaveAttribute('href', 'https://support.google.com/analytics/answer/9037342');
  });

  it('renders wide schema tables inside their own scroll container', () => {
    renderSite(ga4, { route: '/tables/events_' });
    const table = screen.getAllByRole('table')[0]!;
    expect(table.parentElement).toHaveClass('okf-table-scroll');
  });

  it('shows a table of contents built from the body headings', () => {
    renderSite(ga4, { route: '/tables/events_' });
    const toc = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(toc).getByRole('link', { name: 'Schema' })).toHaveAttribute('href', '#schema');
  });

  it('shows which concepts link here', () => {
    renderSite(ga4, { route: '/references/metrics/purchasers' });
    const backlinks = screen.getByRole('region', { name: 'Referenced by' });
    expect(within(backlinks).getByRole('link', { name: 'GA4 Events Export' })).toBeInTheDocument();
  });
});

describe('routing', () => {
  it('renders a directory index at the directory route', () => {
    renderSite(ga4, { route: '/tables' });
    const main = screen.getByRole('main');
    expect(screen.getByRole('heading', { level: 1, name: 'tables' })).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: 'GA4 Events Export' })).toBeInTheDocument();
  });

  it('synthesizes a listing for a directory with no index.md', () => {
    renderSite(edge, { route: '/loose' });
    const main = screen.getByRole('main');
    expect(screen.getByRole('heading', { level: 1, name: 'Loose' })).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: 'Loose thing' })).toBeInTheDocument();
  });

  it('renders a not-found page for an unrouted path', () => {
    renderSite(ga4, { route: '/nope' });
    expect(screen.getByRole('heading', { level: 1, name: 'Not found' })).toBeInTheDocument();
  });

  it('honours renderNotFound', () => {
    renderSite(ga4, { route: '/nope', renderNotFound: (route) => <p>missing {route}</p> });
    expect(screen.getByText('missing /nope')).toBeInTheDocument();
  });

  it('navigates through a relative body link', async () => {
    const { user, router } = renderSite(ga4, { route: '/tables/events_' });
    await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Purchasers' }));
    expect(router.current).toBe('/references/metrics/purchasers');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Purchasers Audience Metric' }),
    ).toBeInTheDocument();
  });

  it('navigates through a bundle-absolute body link', async () => {
    const { user, router } = renderSite(edge, { route: '/draft' });
    await user.click(screen.getByRole('link', { name: 'absolutely' }));
    expect(router.current).toBe('/loose/thing');
  });

  it('navigates through a parent-relative body link', async () => {
    const { user, router } = renderSite(edge, { route: '/loose/thing' });
    await user.click(screen.getByRole('link', { name: 'the draft' }));
    expect(router.current).toBe('/draft');
  });

  it('navigates from the sidebar', async () => {
    const { user, router } = renderSite(ga4, { route: '/' });
    const nav = screen.getByRole('navigation', { name: 'Bundle contents' });
    await user.click(within(nav).getByRole('link', { name: 'tables' }));
    expect(router.current).toBe('/tables');
  });

  it('exposes real hrefs so links stay copyable and middle-clickable', () => {
    renderSite(ga4, { route: '/tables' });
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: 'GA4 Events Export' }),
    ).toHaveAttribute('href', '/tables/events_');
  });

  it('renders a broken link inert rather than as a link to nowhere', () => {
    renderSite(edge, { route: '/draft' });
    expect(screen.queryByRole('link', { name: 'nothing at all' })).not.toBeInTheDocument();
    expect(screen.getByText('nothing at all')).toHaveClass('okf-link--broken');
  });

  it('marks external links as opening away from the site', () => {
    renderSite(edge, { route: '/draft' });
    const external = screen.getByRole('link', { name: 'externally' });
    expect(external).toHaveAttribute('href', 'https://example.com/docs');
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('accepts an already-parsed bundle', () => {
    const bundle = parseBundle(ga4);
    render(<OkfSite bundle={bundle} router={createMemoryRouter('/tables/events_')} />);
    expect(screen.getByRole('heading', { level: 1, name: 'GA4 Events Export' })).toBeInTheDocument();
  });
});

describe('lifecycle banners', () => {
  it('warns on draft, deprecated, and stale content', () => {
    renderSite(edge, { route: '/deprecated', now: new Date('2026-01-01') });
    expect(screen.getByText('This concept is deprecated.')).toBeInTheDocument();
    expect(screen.getByText(/marked stale after/)).toBeInTheDocument();
    expect(screen.getByText('Human reviewed')).toBeInTheDocument();

    cleanup();
    renderSite(edge, { route: '/draft' });
    expect(screen.getByText('This concept is a draft and may change.')).toBeInTheDocument();
  });

  it('renders a concept with no type instead of rejecting it', () => {
    renderSite(edge, { route: '/no-type' });
    expect(screen.getByRole('heading', { level: 1, name: 'Untyped concept' })).toBeInTheDocument();
  });

  it('reports diagnostics to the host', () => {
    const seen: string[] = [];
    renderSite(edge, { route: '/', onDiagnostics: (list) => seen.push(...list.map((d) => d.code)) });
    expect(seen).toContain('missing-type');
    expect(seen).toContain('route-collision');
  });
});

describe('search', () => {
  it('finds a concept by body text and navigates to it', async () => {
    const { user, router } = renderSite(ga4, { route: '/' });
    await user.click(screen.getByRole('button', { name: /Search/ }));
    await user.type(screen.getByRole('combobox'), 'in_app_purchase');

    const results = await screen.findByRole('listbox', { name: 'Search results' });
    expect(within(results).getByText('Purchasers Audience Metric')).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(router.current).toBe('/references/metrics/purchasers');
  });

  it('reports when nothing matches', async () => {
    const { user } = renderSite(ga4, { route: '/' });
    await user.click(screen.getByRole('button', { name: /Search/ }));
    await user.type(screen.getByRole('combobox'), 'zzzznothing');
    expect(await screen.findByText(/No matches/)).toBeInTheDocument();
  });
});

describe('theming hooks', () => {
  it('merges consumer class names into the default okf-* classes', () => {
    const { container } = renderSite(ga4, {
      route: '/',
      classNames: { main: 'prose mx-auto' },
    });
    const main = container.querySelector('main')!;
    expect(main.className).toContain('okf-main');
    expect(main.className).toContain('prose mx-auto');
  });

  it('lets a slot replace a whole region', () => {
    renderSite(ga4, {
      route: '/tables/events_',
      components: { Backlinks: () => <p>custom backlinks</p> },
    });
    expect(screen.getByText('custom backlinks')).toBeInTheDocument();
  });

  it('routes fenced code through highlightCode', () => {
    renderSite(ga4, {
      route: '/references/metrics/purchasers',
      highlightCode: (code, language) => `[${language}:${code.length}]`,
    });
    expect(screen.getByText(/^\[sql:\d+\]$/)).toBeInTheDocument();
  });

  it('turns features off', () => {
    renderSite(ga4, {
      route: '/tables/events_',
      features: { search: false, graph: false, backlinks: false, toc: false },
    });
    expect(screen.queryByRole('button', { name: /Search/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Referenced by' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'On this page' })).not.toBeInTheDocument();
  });
});
