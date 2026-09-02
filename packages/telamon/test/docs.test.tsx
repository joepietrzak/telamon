import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { OkfSite, createMemoryRouter, parseBundle } from '../src/index.js';

afterEach(cleanup);

/**
 * The bundle from the opening snippet of `docs/getting-started.md`, verbatim.
 * It is the first thing a reader copies, so it is worth keeping honest.
 */
const bundle = {
  'index.md': '# Subdirectories\n\n* [tables](tables/index.md) - Our tables.\n',
  'tables/index.md': '# Tables\n\n* [Events](events_.md) - Event export.\n',
  'tables/events_.md': '---\ntype: BigQuery Table\ntitle: Events\n---\n\nOne row per event.\n',
};

describe('the getting-started snippet', () => {
  it('parses without diagnostics', () => {
    expect(parseBundle(bundle).diagnostics).toEqual([]);
  });

  it('renders a navigable site', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter('/');
    render(<OkfSite bundle={bundle} router={router} title="Our knowledge bundle" />);

    expect(screen.getByRole('link', { name: 'Our knowledge bundle' })).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Bundle contents' });
    await user.click(within(nav).getByRole('link', { name: 'tables' }));
    expect(router.current).toBe('/tables');

    await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Events' }));
    expect(router.current).toBe('/tables/events_');
    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument();
    expect(screen.getByText('One row per event.')).toBeInTheDocument();
    expect(screen.getByText('BigQuery Table')).toBeInTheDocument();
  });

  it('offers no references toggle, since this bundle has none', () => {
    render(<OkfSite bundle={bundle} router={createMemoryRouter('/')} />);
    expect(screen.queryByLabelText('Show references')).not.toBeInTheDocument();
  });
});
