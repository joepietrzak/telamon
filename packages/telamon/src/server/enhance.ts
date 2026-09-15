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

/** Upgrade the page in place. Safe to call once the DOM is parsed. */
export function enhancePage(): void {
  const config = settings();
  enhanceNav();
  if (config) enhanceSearch(config);
}
