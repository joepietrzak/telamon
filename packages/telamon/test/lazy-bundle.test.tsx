/**
 * The runtime half of the lazy bundle.
 *
 * The bargain is that a reader cannot tell: the site is navigable from the
 * first render, and a body appears when its document is opened. What a test
 * has to pin is that nothing is lost on the way -- not a document, not a
 * diagnostic, and not the reader's place.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OkfSite, createMemoryRouter, useLazyBundle } from '../src/index.js';
import { manifestEntry } from '../src/vite/index.js';
import { readFixture } from './helpers.js';

afterEach(cleanup);

const full = readFixture('ga4');
const manifest = Object.fromEntries(
  Object.entries(full).map(([path, text]) => [path, manifestEntry(path, text)]),
);

function bodiesFor(files: Record<string, string>, onLoad?: (path: string) => void) {
  return Object.fromEntries(
    Object.entries(files).map(([path, text]) => [
      path,
      () => {
        onLoad?.(path);
        return Promise.resolve(text);
      },
    ]),
  );
}

function Site({
  bodies,
  router,
  onError,
}: {
  bodies: Record<string, () => Promise<string>>;
  router: ReturnType<typeof createMemoryRouter>;
  onError?: (filePath: string, error: unknown) => void;
}) {
  const { bundle, onNavigate } = useLazyBundle({ manifest, bodies, ...(onError && { onError }) });
  return <OkfSite bundle={bundle} router={router} onNavigate={onNavigate} title="GA4" />;
}

describe('useLazyBundle', () => {
  it('is navigable before any body has been read', async () => {
    const asked: string[] = [];
    const router = createMemoryRouter('/');
    const { container } = render(<Site bodies={bodiesFor(full, (p) => asked.push(p))} router={router} />);

    // The tree is drawn from frontmatter, so every route is reachable at once.
    for (const route of ['/tables', '/references', '/datasets', '/graph']) {
      expect(container.querySelector(`a[href="${route}"]`), route).not.toBeNull();
    }
    // And only the document actually on screen was fetched.
    await waitFor(() => expect(asked).toEqual(['index.md']));
  });

  it('shows a title from the manifest and prose once it arrives', async () => {
    const router = createMemoryRouter('/tables/events_');
    render(<Site bodies={bodiesFor(full)} router={router} />);

    // Frontmatter was inlined, so the page identifies itself immediately.
    expect(screen.getByRole('heading', { level: 1, name: 'GA4 Events Export' })).toBeInTheDocument();
    // The prose had to be fetched.
    await waitFor(() => expect(screen.getByRole('article').textContent).toContain('event_date'));
  });

  it('follows a link into a document whose body is not loaded yet', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter('/tables');
    const { container } = render(<Site bodies={bodiesFor(full)} router={router} />);

    const link = container.querySelector<HTMLAnchorElement>('a[href="/tables/events_"]')!;
    await user.click(link);

    expect(router.current).toBe('/tables/events_');
    await waitFor(() => expect(screen.getByRole('article').textContent).toContain('event_date'));
  });

  it('asks for a document once, however often it is visited', async () => {
    const asked: string[] = [];
    const router = createMemoryRouter('/tables/events_');
    render(<Site bodies={bodiesFor(full, (p) => asked.push(p))} router={router} />);
    await waitFor(() => expect(asked).toContain('tables/events_.md'));

    await act(async () => {
      router.navigate('/');
      await Promise.resolve();
    });
    await act(async () => {
      router.navigate('/tables/events_');
      await Promise.resolve();
    });

    expect(asked.filter((p) => p === 'tables/events_.md')).toHaveLength(1);
  });

  it('lets a document be asked for again after a failed read', async () => {
    const onError = vi.fn();
    let attempts = 0;
    const bodies = {
      ...bodiesFor(full),
      'tables/events_.md': () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error('offline'))
          : Promise.resolve(full['tables/events_.md']!);
      },
    };
    const router = createMemoryRouter('/tables/events_');
    render(<Site bodies={bodies} router={router} onError={onError} />);

    // Reported through `onError` rather than thrown, and rather than logged
    // over whatever the application is already saying.
    await waitFor(() => expect(onError).toHaveBeenCalledWith('tables/events_.md', expect.any(Error)));
    expect(attempts).toBe(1);

    // A failed fetch is not an answer, so leaving and returning tries again.
    await act(async () => {
      router.navigate('/');
      await Promise.resolve();
    });
    await act(async () => {
      router.navigate('/tables/events_');
      await Promise.resolve();
    });
    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() => expect(screen.getByRole('article').textContent).toContain('event_date'));
  });

  it('ignores a route with no loader rather than throwing', async () => {
    const router = createMemoryRouter('/tables/events_');
    render(<Site bodies={{}} router={router} />);
    // Frontmatter still renders; there is simply no prose to add.
    expect(screen.getByRole('heading', { level: 1, name: 'GA4 Events Export' })).toBeInTheDocument();
  });
});
