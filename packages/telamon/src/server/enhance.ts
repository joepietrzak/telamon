import {
  INITIAL_VIEW,
  VIEWPORT_CLASS,
  isPan,
  isZoomGesture,
  panned,
  viewTransform,
  zoomed,
  type View,
} from '../components/graph/viewport.js';
import { ENHANCE_SCRIPT_ID, type EnhancePayload } from './ids.js';

/**
 * Progressive enhancement for a served page.
 *
 * Deliberately not React and deliberately tiny: the page arrives rendered, and
 * everything on it already works -- search submits a form, the download is a
 * link, the references toggle is a link. This upgrades those in place rather
 * than supplying them, so a browser that never runs it loses polish and no
 * function at all.
 *
 * It carries no bundle. The only data it ever fetches is the result of a search
 * the reader actually typed.
 */

interface SearchResultLike {
  route: string;
  title: string;
  type?: string;
  snippet?: { text: string };
}

function settings(): EnhancePayload | undefined {
  const element = document.getElementById(ENHANCE_SCRIPT_ID);
  if (!element?.textContent) return undefined;
  try {
    return JSON.parse(element.textContent) as EnhancePayload;
  } catch {
    return undefined;
  }
}

/** True when a keystroke is already going somewhere the reader is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

/**
 * The narrow-screen navigation.
 *
 * Without this the Contents button is inert, so this is the one piece of
 * enhancement a small screen actually notices.
 */
function enhanceNav(): void {
  const button = document.querySelector<HTMLButtonElement>('.okf-nav-button');
  const root = document.querySelector<HTMLElement>('.okf-root');
  if (!button || !root) return;

  button.addEventListener('click', () => {
    const open = root.getAttribute('data-okf-nav-open') === 'true';
    if (open) root.removeAttribute('data-okf-nav-open');
    else root.setAttribute('data-okf-nav-open', 'true');
    button.setAttribute('aria-expanded', String(!open));
  });
}

/**
 * Make the sidebar's expand controls work.
 *
 * The server renders only the branch containing the current page, so every
 * other directory arrives closed with nothing behind it -- which keeps a page
 * small, and leaves the control with nothing to show. This fetches that level
 * the first time it is asked for.
 *
 * Without this the arrows are inert and a reader expands a directory by
 * visiting it, since the label beside each one is a link to the page that
 * lists its contents.
 */
function enhanceNavTree(config: EnhancePayload): void {
  const nav = document.querySelector('.okf-nav');
  if (!nav) return;

  // The state the server rendered is in the URL, so an expanded level matches
  // the sidebar around it.
  const references = new URLSearchParams(window.location.search).get('references');
  const suffix = references === '0' ? '&references=0' : '';

  nav.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest?.('.okf-nav-toggle');
    if (!(button instanceof HTMLButtonElement) || !nav.contains(button)) return;

    const item = button.closest('.okf-nav-item');
    const link = item?.querySelector('.okf-nav-link');
    const route = link?.getAttribute('href');
    if (!item || !route) return;

    const open = button.getAttribute('aria-expanded') === 'true';
    const existing = item.querySelector(':scope > .okf-nav-list');

    if (open) {
      if (existing instanceof HTMLElement) existing.hidden = true;
      setExpanded(button, false);
      return;
    }

    if (existing instanceof HTMLElement) {
      existing.hidden = false;
      setExpanded(button, true);
      return;
    }

    // Not fetched yet. Say so, so a slow network is not silence.
    button.setAttribute('aria-busy', 'true');
    const base = config.basename ?? '';
    const path = route.startsWith(base) ? route.slice(base.length) || '/' : route;

    void fetch(`${config.assetPrefix}/nav.json?route=${encodeURIComponent(path)}${suffix}`, {
      headers: { accept: 'application/json' },
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('no level'))))
      .then((level: { children: NavChildLike[] }) => {
        item.append(buildLevel(level.children, base));
        setExpanded(button, true);
      })
      .catch(() => {
        // Leave it closed. The label next to it still navigates, which is what
        // a reader without JavaScript does anyway.
      })
      .finally(() => button.removeAttribute('aria-busy'));
  });
}

interface NavChildLike {
  route: string;
  label: string;
  kind: string;
  description?: string;
  children: boolean;
}

function setExpanded(button: HTMLButtonElement, open: boolean): void {
  button.setAttribute('aria-expanded', String(open));
  const arrow = button.querySelector('span');
  if (arrow) arrow.textContent = open ? '\u25be' : '\u25b8';
  const label = button.getAttribute('aria-label');
  if (label) {
    button.setAttribute(
      'aria-label',
      label.replace(/^(Expand|Collapse)\b/, open ? 'Collapse' : 'Expand'),
    );
  }
}

/** The same shape `NavTree` renders, so one level looks like any other. */
function buildLevel(children: NavChildLike[], basename: string): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = 'okf-nav-list';

  for (const child of children) {
    const item = document.createElement('li');
    item.className = 'okf-nav-item';
    item.dataset.okfKind = child.kind;

    const row = document.createElement('div');
    row.className = 'okf-nav-row';

    if (child.children) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'okf-nav-toggle';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', `Expand ${child.label}`);
      const arrow = document.createElement('span');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '\u25b8';
      toggle.append(arrow);
      row.append(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'okf-nav-toggle okf-nav-toggle--empty';
      spacer.setAttribute('aria-hidden', 'true');
      row.append(spacer);
    }

    const link = document.createElement('a');
    link.className = 'okf-nav-link';
    link.href = `${basename}${child.route}`;
    link.textContent = child.label;
    if (child.description) link.title = child.description;
    row.append(link);

    item.append(row);
    list.append(item);
  }

  return list;
}

/** Results as you type, over the form that already works without it. */
function enhanceSearch(config: EnhancePayload): void {
  const form = document.querySelector<HTMLFormElement>('form[role="search"]');
  const input = form?.querySelector<HTMLInputElement>('[data-okf-search-input]');
  if (!form || !input) return;

  const panel = document.createElement('div');
  panel.className = 'okf-search-panel';
  panel.hidden = true;
  form.append(panel);

  let active = -1;
  let rows: HTMLAnchorElement[] = [];
  let token = 0;

  const close = () => {
    panel.hidden = true;
    panel.replaceChildren();
    rows = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
  };

  const highlight = (next: number) => {
    if (rows.length === 0) return;
    active = (next + rows.length) % rows.length;
    for (const [index, row] of rows.entries()) {
      row.classList.toggle('okf-search-result-link--active', index === active);
    }
    rows[active]?.scrollIntoView({ block: 'nearest' });
  };

  const render = (results: SearchResultLike[], query: string) => {
    panel.replaceChildren();
    if (results.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'okf-search-empty';
      empty.textContent = `No matches for “${query}”.`;
      panel.append(empty);
      rows = [];
      active = -1;
      panel.hidden = false;
      return;
    }

    const list = document.createElement('ol');
    list.className = 'okf-search-results';
    for (const result of results) {
      const item = document.createElement('li');
      item.className = 'okf-search-result';

      const link = document.createElement('a');
      link.className = 'okf-search-result-link';
      link.href = `${config.basename ?? ''}${result.route}`;

      const title = document.createElement('span');
      title.className = 'okf-search-result-title';
      title.textContent = result.title;
      link.append(title);

      if (result.type) {
        const badge = document.createElement('span');
        badge.className = 'okf-badge okf-badge--type';
        badge.textContent = result.type;
        link.append(badge);
      }

      item.append(link);

      if (result.snippet) {
        const snippet = document.createElement('p');
        snippet.className = 'okf-search-result-snippet';
        snippet.textContent = result.snippet.text;
        item.append(snippet);
      }

      list.append(item);
    }

    panel.append(list);
    rows = [...panel.querySelectorAll<HTMLAnchorElement>('.okf-search-result-link')];
    active = -1;
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const run = async () => {
    const query = input.value.trim();
    if (query === '') {
      close();
      return;
    }
    const mine = ++token;
    try {
      const response = await fetch(
        `${config.assetPrefix}/search.json?q=${encodeURIComponent(query)}`,
        { headers: { accept: 'application/json' } },
      );
      if (!response.ok) return;
      const found = (await response.json()) as { results: SearchResultLike[] };
      // A slower earlier request must not overwrite a newer one's results.
      if (mine !== token) return;
      render(found.results, query);
    } catch {
      // Offline, or the endpoint is not there: the form still submits.
    }
  };

  let timer: number | undefined;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), 120);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (rows.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight(active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(active - 1);
    } else if (event.key === 'Enter' && active >= 0) {
      // Only when a row is chosen; otherwise the form submits as it always would.
      event.preventDefault();
      rows[active]?.click();
    }
  });

  document.addEventListener('click', (event) => {
    if (!form.contains(event.target as Node)) close();
  });

  document.addEventListener('keydown', (event) => {
    const shortcut =
      (event.key === 'k' && (event.metaKey || event.ctrlKey)) ||
      (event.key === '/' && !event.metaKey && !event.ctrlKey && !isTypingTarget(event.target));
    if (!shortcut) return;
    event.preventDefault();
    input.focus();
    input.select();
  });
}

/**
 * Pan and zoom on a served graph page.
 *
 * The layout arrives settled -- the server ran the simulation and the
 * coordinates are in the markup -- so there is nothing to compute here and no
 * reason to ship d3 or React to do it. Two gestures move one group.
 *
 * Pointer events rather than mouse events, so a finger pans too -- which is
 * also why the `touch-action: none` that makes that possible is gated on the
 * class this sets at the end. A reader whose browser never runs this keeps
 * their scroll and a graph of nodes that are still links.
 */
function enhanceGraph(): void {
  const canvas = document.querySelector<SVGSVGElement>('.okf-graph-canvas');
  const viewport = canvas?.querySelector<SVGGElement>(`.${VIEWPORT_CLASS}`);
  if (!canvas || !viewport) return;

  let view: View = INITIAL_VIEW;
  let drag: {
    pointerId: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    panning: boolean;
  } | null = null;
  /** True once a press has travelled far enough to pan, so the click it ends with is ignored. */
  let dragged = false;

  const apply = (next: View): void => {
    if (next === view) return;
    view = next;
    viewport.setAttribute('transform', viewTransform(view));
  };

  canvas.addEventListener('pointerdown', (event) => {
    // Deliberately no setPointerCapture here. Capturing on press retargets the
    // click that follows to the canvas, so a node's own href never opens --
    // capture is taken below, only once a pan really starts.
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      panning: false,
    };
    dragged = false;
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.panning) {
      if (!isPan(event.clientX - drag.startX, event.clientY - drag.startY)) return;
      drag.panning = true;
      dragged = true;
      canvas.setPointerCapture(event.pointerId);
    }

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    // `panned` keeps NaN out of the transform, but the origin has to be
    // guarded here: recording a coordinate-less event as the new origin makes
    // every later delta NaN, and the pan is stuck for the rest of the gesture.
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    apply(panned(view, dx, dy));
  });

  const endDrag = (event: PointerEvent): void => {
    if (drag?.pointerId !== event.pointerId) return;
    if (drag.panning && canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // The click that ends a pan belongs to the pan, not to whichever node the
  // pointer happened to stop on. Capture phase: an anchor navigates on its
  // default action, and this has to be in before that.
  canvas.addEventListener(
    'click',
    (event) => {
      if (!dragged) return;
      dragged = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  // Non-passive, because a zoom has to cancel the event: a trackpad pinch
  // arrives here as a ctrl-wheel, and left alone the browser zooms the entire
  // page on top of the graph. A bare wheel is not a zoom and is left to scroll
  // the page, so nobody is trapped in a graph they were only scrolling past.
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!isZoomGesture(event)) return;
      event.preventDefault();
      apply(zoomed(view, event.deltaY));
    },
    { passive: false },
  );

  canvas.classList.add('okf-graph-canvas--interactive');
}

/** Upgrade the page in place. Safe to call once the DOM is parsed. */
export function enhancePage(): void {
  const config = settings();
  enhanceNav();
  enhanceGraph();
  if (config) {
    enhanceNavTree(config);
    enhanceSearch(config);
  }
}
