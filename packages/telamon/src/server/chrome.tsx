import { useClassName, useOkfConfig, useReferences } from '../components/context.js';
import { Link } from '../router/context.js';
import type { SearchResult } from '../bundle/search.js';

/**
 * Chrome for a served site.
 *
 * A served page carries no bundle, so the three features that want the whole
 * corpus -- search, the source download, and the references toggle -- cannot be
 * the browser-side components. Each becomes a plain link or form the server
 * answers, which means all three work with JavaScript switched off entirely;
 * the enhancement script upgrades them in place rather than supplying them.
 */

export interface ServerChromeUrls {
  /** Route the server renders search results at. */
  searchRoute: string;
  /** Where the endpoints live, e.g. `/_telamon`. */
  assetPrefix: string;
}

/** The current query, for pre-filling the box on a results page. */
export function ServerSearchBox({ urls, query }: { urls: ServerChromeUrls; query: string }) {
  const className = useClassName('search');
  return (
    <form className={className} action={urls.searchRoute} method="get" role="search">
      <input
        className="okf-search-input okf-search-input--inline"
        type="search"
        name="q"
        defaultValue={query}
        placeholder="Search this bundle"
        aria-label="Search this bundle"
        autoComplete="off"
        data-okf-search-input=""
      />
      <button type="submit" className="okf-search-submit">
        Search
      </button>
    </form>
  );
}

/** A link rather than a checkbox: the server owns the state, so it is in the URL. */
export function ServerReferencesToggle({ route }: { route: string }) {
  const className = useClassName('referencesToggle');
  const { available, visible } = useReferences();
  if (!available) return null;

  const target = `${route}${visible ? '?references=0' : ''}`;
  return (
    <a className={className} href={target} rel="nofollow">
      {visible ? 'Hide references' : 'Show references'}
    </a>
  );
}

/** The zip is built by the server, so the download needs no script at all. */
export function ServerDownloadLink({ urls, name }: { urls: ServerChromeUrls; name: string }) {
  const className = useClassName('download');
  return (
    <a className={className} href={`${urls.assetPrefix}/bundle.zip`} download={name}>
      Download
    </a>
  );
}

export interface SearchResultsPageProps {
  query: string;
  results: SearchResult[];
  /** Matches withheld because references are hidden. */
  hiddenMatches: number;
  route: string;
}

/** The page the search form submits to, rendered by the server. */
export function SearchResultsPage({ query, results, hiddenMatches, route }: SearchResultsPageProps) {
  const className = useClassName('searchResults');
  const { title } = useOkfConfig();
  const trimmed = query.trim();

  return (
    <div className="okf-search-page">
      <h1 className="okf-title">{trimmed === '' ? 'Search' : `Results for “${trimmed}”`}</h1>

      {trimmed === '' ? (
        <p className="okf-search-empty">Type a query to search {title}.</p>
      ) : results.length === 0 ? (
        <p className="okf-search-empty">No matches for “{trimmed}”.</p>
      ) : (
        <ol className={className} data-okf-search-results="">
          {results.map((result) => (
            <li key={result.route} className="okf-search-result">
              <Link to={result.route} className="okf-search-result-link">
                <span className="okf-search-result-title">{result.title}</span>
                {result.type ? <span className="okf-badge okf-badge--type">{result.type}</span> : null}
              </Link>
              {result.snippet ? (
                <p className="okf-search-result-snippet">{result.snippet.text}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {hiddenMatches > 0 ? (
        <p className="okf-search-hidden-note">
          {hiddenMatches} more in references.{' '}
          <a href={`${route}?q=${encodeURIComponent(trimmed)}&references=1`}>Show them</a>
        </p>
      ) : null}
    </div>
  );
}
