/**
 * The graph's pan-and-zoom view.
 *
 * Two things drive it: `GraphView` on a page React has taken over, and the
 * enhancement script on a page the server rendered. Both move the same group
 * through the same arithmetic, so the arithmetic lives here -- including the
 * guards against pointer and wheel events that carry no usable numbers, which
 * are the kind of thing that gets fixed once and then silently not fixed in
 * the copy.
 *
 * This file imports nothing. It is pulled into the enhancement bundle, which
 * carries neither React nor d3 and should keep not carrying them.
 */

/** Pointer travel, in px, before a press counts as a pan rather than a click. */
export const DRAG_THRESHOLD = 4;
export const ZOOM_STEP = 1.12;
export const MIN_SCALE = 0.3;
export const MAX_SCALE = 4;

/**
 * The group holding every node and edge -- the thing that actually moves.
 *
 * The enhancement script finds it by this class, so it is markup contract
 * rather than styling.
 */
export const VIEWPORT_CLASS = 'okf-graph-viewport';

export interface View {
  x: number;
  y: number;
  scale: number;
}

export const INITIAL_VIEW: View = { x: 0, y: 0, scale: 1 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The transform a view puts on the viewport group. */
export function viewTransform(view: View): string {
  return `translate(${view.x} ${view.y}) scale(${view.scale})`;
}

/**
 * The view after a pan of (dx, dy).
 *
 * A single coordinate-less event mid-pan would put NaN into the transform and
 * nothing later would ever bring it back, so a non-finite delta is not a pan.
 */
export function panned(view: View, dx: number, dy: number): View {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return view;
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/**
 * The view after one wheel notch.
 *
 * No usable delta is not a zoom. This rejects NaN and a missing deltaY as well
 * as 0, which a horizontal-only scroll reports -- a plain `deltaY < 0` test
 * quietly reads all three as "zoom out".
 */
export function zoomed(view: View, deltaY: number): View {
  if (!Number.isFinite(deltaY) || deltaY === 0) return view;
  const factor = deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  return Number.isFinite(scale) ? { ...view, scale } : view;
}

/**
 * True once a press has travelled far enough to be a pan rather than a click.
 *
 * Written so a NaN distance is false: ambiguous input must not become a pan,
 * because the click a pan swallows is one that never reaches a node.
 */
export function isPan(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > DRAG_THRESHOLD;
}
