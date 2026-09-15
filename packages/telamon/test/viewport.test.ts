/**
 * The graph's view arithmetic.
 *
 * It is shared by a React component and a vanilla enhancement script, so the
 * awkward inputs are pinned here once rather than in each caller's suite: a
 * wheel event with no delta, a pointer event with no coordinates, and a reader
 * who keeps scrolling long after the scale has bottomed out.
 */
import { describe, expect, it } from 'vitest';
import {
  INITIAL_VIEW,
  MAX_SCALE,
  MIN_SCALE,
  isPan,
  isZoomGesture,
  panned,
  viewTransform,
  zoomed,
} from '../src/components/graph/viewport.js';

describe('zoomed', () => {
  it('zooms in on a negative delta and out on a positive one', () => {
    expect(zoomed(INITIAL_VIEW, -100).scale).toBeGreaterThan(1);
    expect(zoomed(INITIAL_VIEW, 100).scale).toBeLessThan(1);
  });

  it('clamps rather than running away', () => {
    let view = INITIAL_VIEW;
    for (let i = 0; i < 40; i += 1) view = zoomed(view, -100);
    expect(view.scale).toBeCloseTo(MAX_SCALE);

    for (let i = 0; i < 80; i += 1) view = zoomed(view, 100);
    expect(view.scale).toBeCloseTo(MIN_SCALE);
  });

  it('treats a delta it cannot use as no zoom at all', () => {
    // 0 is what a horizontal-only scroll reports, and NaN is what an event
    // arriving without delta information gives you. Neither is "zoom out".
    for (const delta of [0, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
      expect(zoomed(INITIAL_VIEW, delta)).toBe(INITIAL_VIEW);
    }
  });
});

describe('isZoomGesture', () => {
  it('needs a modifier, so a bare wheel stays the page\'s', () => {
    expect(isZoomGesture({ ctrlKey: false, metaKey: false })).toBe(false);
    expect(isZoomGesture({ ctrlKey: true, metaKey: false })).toBe(true);
    // ⌘ on a Mac, where ctrl is not the scroll modifier readers reach for.
    expect(isZoomGesture({ ctrlKey: false, metaKey: true })).toBe(true);
  });
});

describe('panned', () => {
  it('moves by the delta', () => {
    expect(panned(INITIAL_VIEW, 60, 30)).toEqual({ x: 60, y: 30, scale: 1 });
  });

  it('refuses a delta that would poison the transform', () => {
    // One NaN here and nothing later ever brings the transform back.
    expect(panned(INITIAL_VIEW, Number.NaN, 30)).toBe(INITIAL_VIEW);
    expect(panned(INITIAL_VIEW, 60, Number.NaN)).toBe(INITIAL_VIEW);
  });
});

describe('isPan', () => {
  it('needs real travel, and reads ambiguous travel as a click', () => {
    expect(isPan(0, 0)).toBe(false);
    expect(isPan(2, 2)).toBe(false);
    expect(isPan(60, 0)).toBe(true);
    // A click swallowed by a pan that never happened is a node that never opens.
    expect(isPan(Number.NaN, 0)).toBe(false);
  });
});

describe('viewTransform', () => {
  it('writes a transform SVG accepts', () => {
    expect(viewTransform(INITIAL_VIEW)).toBe('translate(0 0) scale(1)');
    expect(viewTransform({ x: 60, y: -30, scale: 2 })).toBe('translate(60 -30) scale(2)');
  });
});
