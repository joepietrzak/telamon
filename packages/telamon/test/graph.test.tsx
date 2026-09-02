import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { OkfSite, createMemoryRouter, type MemoryRouter } from '../src/index.js';
import { readFixture } from './helpers.js';

const ga4 = readFixture('ga4');
const edge = readFixture('edge');

afterEach(cleanup);

async function renderGraph(
  files: Record<string, string> = ga4,
): Promise<{ router: MemoryRouter; canvas: SVGElement }> {
  const router = createMemoryRouter('/graph');
  render(<OkfSite bundle={files} router={router} />);
  // The graph is a lazy chunk; test/setup.ts raises the global findBy ceiling
  // so resolving it under load does not race the default 1s timeout.
  const canvas = await screen.findByRole('group', { name: /Force-directed graph/ });
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

describe('typed relationship edges', () => {
  it('draws untyped body links without direction or a label', async () => {
    const { canvas } = await renderGraph();
    expect(canvas.querySelectorAll('.okf-graph-edge').length).toBeGreaterThan(0);
    expect(canvas.querySelectorAll('.okf-graph-edge--typed')).toHaveLength(0);
    expect(canvas.querySelectorAll('.okf-graph-edge-label')).toHaveLength(0);
    for (const edgePath of canvas.querySelectorAll('.okf-graph-edge')) {
      expect(edgePath.getAttribute('marker-end')).toBeNull();
    }
  });

  it('draws a relationship as a labelled, arrow-headed edge', async () => {
    const { canvas } = await renderGraph(edge);

    const typed = [...canvas.querySelectorAll('.okf-graph-edge--typed')];
    expect(typed.length).toBeGreaterThan(0);
    expect(typed.every((edgePath) => edgePath.getAttribute('marker-end')?.startsWith('url(#'))).toBe(
      true,
    );

    const labels = [...canvas.querySelectorAll('.okf-graph-edge-label')].map((n) => n.textContent);
    expect(labels).toContain('depends_on');
    expect(labels).toContain('derived_from');
  });

  it('bows parallel edges apart instead of stacking them', async () => {
    const { canvas } = await renderGraph(edge);
    const curved = [...canvas.querySelectorAll('.okf-graph-edge')].filter((edgePath) =>
      edgePath.getAttribute('d')?.includes('Q'),
    );
    // /relationships and /loose/thing are joined by three edges. Offsets are
    // symmetric about zero, so the middle of an odd group stays straight and
    // the two either side bow away from it.
    expect(curved.length).toBeGreaterThanOrEqual(2);

    const all = [...canvas.querySelectorAll('.okf-graph-edge')].map((e) => e.getAttribute('d'));
    expect(new Set(all).size).toBe(all.length); // nothing drawn on top of anything else
    expect(all.every((d) => d && !d.includes('NaN'))).toBe(true);
  });

  it('renders an arrowhead marker definition', async () => {
    const { canvas } = await renderGraph(edge);
    expect(canvas.querySelectorAll('marker')).toHaveLength(2);
  });
});
