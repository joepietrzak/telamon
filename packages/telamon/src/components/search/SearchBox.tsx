import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from '../../router/context.js';
import { useClassName, useReferences, useSearch } from '../context.js';
import { SearchResults } from './SearchResults.js';

const LIMIT = 12;

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
 * Search entry point: a button in the header that opens a dialog, reachable
 * with `/` or ⌘K.
 */
export function SearchBox() {
  const className = useClassName('search');
  const resultsClassName = useClassName('searchResults');
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // The highlighted row is stored with the query it was chosen for, so typing
  // resets it during render rather than through a second render pass.
  const [active, setActive] = useState({ query: '', index: 0 });
  const activeIndex = active.query === query ? active.index : 0;
  const setActiveIndex = useCallback(
    (next: number | ((current: number) => number)) =>
      setActive((current) => {
        const base = current.query === query ? current.index : 0;
        return { query, index: typeof next === 'function' ? next(base) : next };
      }),
    [query],
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const listId = useId();
  const optionId = useCallback((index: number) => `${listId}-option-${index}`, [listId]);

  const references = useReferences();
  const results = useSearch(open ? query : '', { limit: LIMIT });
  // Run the same query unfiltered so the reader is told when hiding references
  // is the reason a match is missing, rather than being shown a bare "no
  // matches" for something the bundle does contain.
  const unfiltered = useSearch(open ? query : '', { limit: LIMIT, includeHidden: true });
  const hiddenMatches = references.visible ? 0 : unfiltered.length - results.length;

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive({ query: '', index: 0 });
    openerRef.current?.focus();
  }, []);

  const openPanel = useCallback(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isShortcut =
        (event.key === 'k' && (event.metaKey || event.ctrlKey)) ||
        (event.key === '/' && !event.metaKey && !event.ctrlKey && !isTypingTarget(event.target));
      if (!isShortcut) return;
      event.preventDefault();
      openPanel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openPanel]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const select = useCallback(
    (route: string) => {
      close();
      navigate(route);
    },
    [close, navigate],
  );

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const result = results[activeIndex];
      if (result) select(result.route);
    }
  };

  return (
    <div className={className}>
      <button type="button" className="okf-search-trigger" onClick={openPanel}>
        <span>Search</span>
        <kbd className="okf-kbd">/</kbd>
      </button>

      {open ? (
        <div
          className="okf-search-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="okf-search-dialog" role="dialog" aria-modal="true" aria-label="Search">
            <input
              ref={inputRef}
              className="okf-search-input"
              type="search"
              placeholder="Search this bundle"
              value={query}
              autoComplete="off"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={listId}
              aria-activedescendant={results.length > 0 ? optionId(activeIndex) : undefined}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
            />
            <div className={resultsClassName}>
              {query.trim() !== '' && results.length === 0 ? (
                <p className="okf-search-empty">No matches for “{query}”.</p>
              ) : (
                <SearchResults
                  results={results}
                  activeIndex={activeIndex}
                  listId={listId}
                  optionId={optionId}
                  onSelect={select}
                  onHover={setActiveIndex}
                />
              )}
              {hiddenMatches > 0 ? (
                <p className="okf-search-hidden-note">
                  {hiddenMatches} more in references.{' '}
                  <button
                    type="button"
                    className="okf-search-hidden-show"
                    onClick={() => references.setVisible(true)}
                  >
                    Show them
                  </button>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
