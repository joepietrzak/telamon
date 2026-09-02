import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { OkfSite, createMemoryRouter, type MemoryRouter } from '../src/index.js';
import { readFixture } from './helpers.js';

const ga4 = readFixture('ga4');

afterEach(cleanup);

async function renderGraph(): Promise<{ router: MemoryRouter; canvas: SVGElement }> {
  const router = createMemoryRouter('/graph');
  render(<OkfSite bundle={ga4} router={router} />);
  // The graph is a lazy chunk. The default 1s findBy timeout is enough on an
  // idle machine but not when the suite shares a CPU with a typecheck or build,
  // so give Suspense room rather than leaving a flaky test in the suite.
  const canvas = await screen.findByRole(
    'group',
    { name: /Force-directed graph/ },
    { timeout: 10_000 },
  );
  return { router, canvas: canvas as unknown as SVGElement };
}

const nodeFor = (name: RegExp | string) => screen.getByRole('button', { name });

/**
 * jsdom implements no `PointerEvent`, and `fireEvent.pointerMove(el, { clientX })`
 * silently drops the coordinates on the floor. Dispatching a `MouseEvent` under
 * the pointer event's type is what actually delivers them, which is the whole
 * point of these tests.
 */
function pointer(canvas: Element, type: string, x: number, y: number) {
  fireEvent(canvas, new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
}

/** Press, travel `distance` px, release — the pan gesture. */
function drag(canvas: Element, distance: number) {
  pointer(canvas, 'pointerdown', 100, 100);
  pointer(canvas, 'pointermove', 100 + distance, 100);
  pointer(canvas, 'pointerup', 100 + distance, 100);
}

describe('graph node navigation', () => {
  it('navigates when a node is clicked', async () => {
    const user = userEvent.setup();
    const { router } = await renderGraph();

    await user.click(nodeFor(/GA4 Events Export/));
    expect(router.current).toBe('/tables/events_');
  });

  it('does not navigate on the click that ends a pan', async () => {
    const { router, canvas } = await renderGraph();

    drag(canvas, 60);
    fireEvent.click(nodeFor(/GA4 Events Export/));

    expect(router.current).toBe('/graph');
  });

  it('still navigates after a press that barely moved', async () => {
    const { router, canvas } = await renderGraph();

    // Under the threshold: a shaky click is a click, not a pan.
    drag(canvas, 2);
    fireEvent.click(nodeFor(/GA4 Events Export/));

    expect(router.current).toBe('/tables/events_');
  });

  it('navigates from the keyboard', async () => {
    const user = userEvent.setup();
    const { router } = await renderGraph();

    nodeFor(/GA4 Events Export/).focus();
    await user.keyboard('{Enter}');
    expect(router.current).toBe('/tables/events_');
  });

  it('exposes nodes as named, focusable controls', async () => {
    await renderGraph();
    const node = nodeFor(/GA4 Events Export/);
    expect(node).toHaveAttribute('tabindex', '0');
    expect(node).toHaveAccessibleName('GA4 Events Export, BigQuery Table');
  });

  it('offers the same concepts as text for keyboard and reader use', async () => {
    await renderGraph();
    const listing = screen.getByRole('region', { name: 'All concepts' });
    expect(within(listing).getByRole('link', { name: 'GA4 Events Export' })).toHaveAttribute(
      'href',
      '/tables/events_',
    );
  });
});
