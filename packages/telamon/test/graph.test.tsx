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

/** The inner <g> carries the pan/zoom transform. */
const transformOf = (canvas: Element) =>
  canvas.querySelector('g')?.getAttribute('transform') ?? '';

const scaleOf = (canvas: Element) => Number(/scale\(([-\d.e]+)\)/.exec(transformOf(canvas))?.[1]);

function wheel(canvas: Element, deltaY?: number) {
  // A plain Event carries no deltaY at all, which is the realistic stand-in for
  // an event arriving without usable delta information.
  const event =
    deltaY === undefined
      ? new Event('wheel', { bubbles: true })
      : new WheelEvent('wheel', { deltaY, bubbles: true });
  fireEvent(canvas, event);
}

describe('pan and zoom', () => {
  it('zooms in and out within bounds', async () => {
    const { canvas } = await renderGraph();
    expect(scaleOf(canvas)).toBeCloseTo(1);

    wheel(canvas, -100);
    expect(scaleOf(canvas)).toBeGreaterThan(1);

    wheel(canvas, 100);
    expect(scaleOf(canvas)).toBeCloseTo(1);
  });

  it('clamps rather than running away', async () => {
    const { canvas } = await renderGraph();
    for (let i = 0; i < 40; i += 1) wheel(canvas, -100);
    expect(scaleOf(canvas)).toBeCloseTo(4);

    for (let i = 0; i < 80; i += 1) wheel(canvas, 100);
    expect(scaleOf(canvas)).toBeCloseTo(0.3);
  });

  it('ignores a wheel event with no usable delta', async () => {
    const { canvas } = await renderGraph();
    const before = transformOf(canvas);

    wheel(canvas); // no deltaY at all
    wheel(canvas, 0); // horizontal-only scroll

    expect(transformOf(canvas)).toBe(before);
    expect(scaleOf(canvas)).toBeCloseTo(1);
  });

  it('pans, and never lets a coordinate-less event poison the transform', async () => {
    const { canvas } = await renderGraph();

    pointer(canvas, 'pointerdown', 100, 100);
    pointer(canvas, 'pointermove', 160, 130);
    expect(transformOf(canvas)).toContain('translate(60 30)');

    // Mid-pan event with no coordinates: must be ignored, not turn the
    // transform into NaN for the rest of the session.
    fireEvent(canvas, new Event('pointermove', { bubbles: true }));
    expect(transformOf(canvas)).toContain('translate(60 30)');

    // Panning still works afterwards.
    pointer(canvas, 'pointermove', 170, 130);
    pointer(canvas, 'pointerup', 170, 130);
    expect(transformOf(canvas)).toContain('translate(70 30)');
    expect(transformOf(canvas)).not.toContain('NaN');
  });
});

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
