import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OkfSite,
  createMemoryRouter,
  filterNavTree,
  isReferenceDoc,
  parseBundle,
  referenceRoutes,
  type OkfSiteProps,
} from '../src/index.js';
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

const sidebar = () => screen.getByRole('navigation', { name: 'Bundle contents' });

describe('identifying reference concepts', () => {
  const bundle = parseBundle(ga4);

  it('matches anything under a references/ directory, at any depth', () => {
    expect(isReferenceDoc(bundle.byRoute.get('/references')!)).toBe(true);
    expect(isReferenceDoc(bundle.byRoute.get('/references/metrics')!)).toBe(true);
    expect(isReferenceDoc(bundle.byRoute.get('/references/metrics/purchasers')!)).toBe(true);
    expect(isReferenceDoc(bundle.byRoute.get('/tables/events_')!)).toBe(false);
    expect(isReferenceDoc(bundle.byRoute.get('/')!)).toBe(false);
  });

  it('collects the routes to hide', () => {
    const routes = referenceRoutes(bundle);
    expect(routes.has('/references/metrics/purchasers')).toBe(true);
    expect(routes.has('/tables/events_')).toBe(false);
    expect(routes.size).toBe(9);
  });

  it('prunes hidden branches and leaves the rest by identity', () => {
    const hidden = referenceRoutes(bundle);
    const filtered = filterNavTree(bundle.tree, hidden);
    expect(filtered.map((node) => node.route)).toEqual(['/datasets', '/tables']);
    // Untouched branches keep their object identity, so React keeps the subtree.
    expect(filtered[1]).toBe(bundle.tree.find((node) => node.route === '/tables'));
    expect(filterNavTree(bundle.tree, new Set())).toBe(bundle.tree);
  });

  it('drops a directory whose whole contents are hidden even with no index.md', () => {
    const files = {
      'a.md': '---\ntype: Concept\n---\nA.',
      'stuff/references/one.md': '---\ntype: Reference\n---\nOne.',
      'stuff/keep.md': '---\ntype: Concept\n---\nKeep.',
    };
    const bundleWithoutIndex = parseBundle(files);
    const filtered = filterNavTree(bundleWithoutIndex.tree, referenceRoutes(bundleWithoutIndex));
    const stuff = filtered.find((node) => node.route === '/stuff');
    expect(stuff?.children.map((child) => child.route)).toEqual(['/stuff/keep']);
  });
});

describe('the toggle', () => {
  it('appears only when the bundle has references', () => {
    renderSite(ga4);
    expect(screen.getByLabelText('Show references')).toBeInTheDocument();

    cleanup();
    renderSite(edge);
    expect(screen.queryByLabelText('Show references')).not.toBeInTheDocument();
  });

  it('hides the references branch from the sidebar when switched off', async () => {
    const { user } = renderSite(ga4);
    expect(within(sidebar()).getByRole('link', { name: 'references' })).toBeInTheDocument();

    await user.click(screen.getByLabelText('Show references'));

    expect(within(sidebar()).queryByRole('link', { name: 'references' })).not.toBeInTheDocument();
    expect(
      within(sidebar()).queryByRole('link', { name: 'Purchasers Audience Metric' }),
    ).not.toBeInTheDocument();
    // Everything substantive stays.
    expect(within(sidebar()).getByRole('link', { name: 'tables' })).toBeInTheDocument();
    expect(within(sidebar()).getByRole('link', { name: 'datasets' })).toBeInTheDocument();
  });

  it('starts hidden when asked to', () => {
    renderSite(ga4, { defaultShowReferences: false });
    expect(within(sidebar()).queryByRole('link', { name: 'references' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Show references')).not.toBeChecked();
  });

  it('can be driven as a controlled input', async () => {
    const onChange = vi.fn();
    const { user, rerender } = renderSite(ga4, {
      showReferences: false,
      onShowReferencesChange: onChange,
    });
    expect(within(sidebar()).queryByRole('link', { name: 'references' })).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Show references'));
    expect(onChange).toHaveBeenCalledWith(true);
    // Still hidden: the host owns the state and has not changed it yet.
    expect(within(sidebar()).queryByRole('link', { name: 'references' })).not.toBeInTheDocument();

    rerender(
      <OkfSite
        bundle={ga4}
        router={createMemoryRouter('/')}
        showReferences
        onShowReferencesChange={onChange}
      />,
    );
    expect(within(sidebar()).getByRole('link', { name: 'references' })).toBeInTheDocument();
  });

  it('accepts a different rule for what counts as a reference', async () => {
    const { user } = renderSite(ga4, {
      isReference: (doc) => doc.frontmatter.type === 'BigQuery Table',
    });
    await user.click(screen.getByLabelText('Show references'));

    expect(within(sidebar()).queryByRole('link', { name: 'GA4 Events Export' })).not.toBeInTheDocument();
    expect(within(sidebar()).getByRole('link', { name: 'references' })).toBeInTheDocument();
  });

  it('can be removed entirely', () => {
    renderSite(ga4, { features: { referenceToggle: false } });
    expect(screen.queryByLabelText('Show references')).not.toBeInTheDocument();
    expect(within(sidebar()).getByRole('link', { name: 'references' })).toBeInTheDocument();
  });
});

describe('hidden references stay reachable', () => {
  it('still renders a hidden concept at its own route', () => {
    renderSite(ga4, { route: '/references/metrics/purchasers', defaultShowReferences: false });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Purchasers Audience Metric' }),
    ).toBeInTheDocument();
  });

  it('still follows links from other concepts into a hidden reference', async () => {
    const { user, router } = renderSite(ga4, {
      route: '/tables/events_',
      defaultShowReferences: false,
    });
    await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Purchasers' }));
    expect(router.current).toBe('/references/metrics/purchasers');
  });

  it('keeps backlinks from hidden references visible', () => {
    renderSite(ga4, { route: '/tables/events_', defaultShowReferences: false });
    expect(screen.getByRole('region', { name: 'Referenced by' })).toBeInTheDocument();
  });
});

describe('search', () => {
  it('drops hidden references from results and says how many', async () => {
    const { user } = renderSite(ga4, { defaultShowReferences: false });
    await user.click(screen.getByRole('button', { name: /Search/ }));
    await user.type(screen.getByRole('combobox'), 'in_app_purchase');

    expect(await screen.findByText(/more in references/)).toBeInTheDocument();
    expect(screen.queryByText('Purchasers Audience Metric')).not.toBeInTheDocument();
  });

  it('reveals them from the search dialog', async () => {
    const { user } = renderSite(ga4, { defaultShowReferences: false });
    await user.click(screen.getByRole('button', { name: /Search/ }));
    await user.type(screen.getByRole('combobox'), 'in_app_purchase');
    await user.click(await screen.findByRole('button', { name: 'Show them' }));

    const results = await screen.findByRole('listbox', { name: 'Search results' });
    expect(within(results).getByText('Purchasers Audience Metric')).toBeInTheDocument();
    expect(screen.getByLabelText('Show references')).toBeChecked();
  });

  it('says nothing about references when they are shown', async () => {
    const { user } = renderSite(ga4);
    await user.click(screen.getByRole('button', { name: /Search/ }));
    await user.type(screen.getByRole('combobox'), 'in_app_purchase');
    await screen.findByRole('listbox', { name: 'Search results' });
    expect(screen.queryByText(/more in references/)).not.toBeInTheDocument();
  });
});
