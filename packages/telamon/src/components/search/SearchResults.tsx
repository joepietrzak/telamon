import type { SearchResult, SearchSnippet } from '../../bundle/search.js';

/** Slice a snippet into plain and highlighted runs using the index's ranges. */
function Snippet({ snippet }: { snippet: SearchSnippet }) {
  const parts: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const highlight of snippet.highlights) {
    if (highlight.start > cursor) {
      parts.push({ text: snippet.text.slice(cursor, highlight.start), match: false });
    }
    parts.push({ text: snippet.text.slice(highlight.start, highlight.end), match: true });
    cursor = highlight.end;
  }
  if (cursor < snippet.text.length) parts.push({ text: snippet.text.slice(cursor), match: false });

  return (
    <p className="okf-search-snippet">
      {parts.map((part, index) =>
        part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </p>
  );
}

export interface SearchResultsProps {
  results: SearchResult[];
  activeIndex: number;
  listId: string;
  optionId: (index: number) => string;
  onSelect: (route: string) => void;
  onHover: (index: number) => void;
}

export function SearchResults({
  results,
  activeIndex,
  listId,
  optionId,
  onSelect,
  onHover,
}: SearchResultsProps) {
  return (
    <ul className="okf-search-results" id={listId} role="listbox" aria-label="Search results">
      {results.map((result, index) => (
        <li
          key={result.route}
          id={optionId(index)}
          role="option"
          aria-selected={index === activeIndex}
          className={`okf-search-result${index === activeIndex ? ' okf-search-result--active' : ''}`}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => {
            // Fire before the input's blur closes the panel.
            event.preventDefault();
            onSelect(result.route);
          }}
        >
          <span className="okf-search-result-title">{result.title}</span>
          {result.type ? <span className="okf-badge okf-badge--type">{result.type}</span> : null}
          <span className="okf-search-result-route">{result.route}</span>
          {result.snippet ? <Snippet snippet={result.snippet} /> : null}
        </li>
      ))}
    </ul>
  );
}
