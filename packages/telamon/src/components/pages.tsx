import type { ConceptDoc, IndexDoc, LogDoc, NavNode } from '../bundle/types.js';
import { Markdown } from '../markdown/render.js';
import { Link } from '../router/context.js';
import { DocProvider, useClassName, useOkfConfig } from './context.js';
import { ConceptFooter } from './metadata.js';

/** A concept document: frontmatter chrome, the rendered body, sources, backlinks. */
export function ConceptPage({ doc }: { doc: ConceptDoc }) {
  const className = useClassName('article');
  const { features, slots } = useOkfConfig();

  return (
    <DocProvider doc={doc}>
      <article className={className}>
        <slots.ConceptHeader doc={doc} />
        <div className="okf-prose">
          <Markdown doc={doc} />
        </div>
        <slots.Relationships doc={doc} />
        <slots.SourcesList doc={doc} />
        <ConceptFooter doc={doc} />
        {features.backlinks ? <slots.Backlinks route={doc.route} /> : null}
      </article>
    </DocProvider>
  );
}

/** A directory's own `index.md` (SPEC §8). Its body already is the listing. */
export function IndexPage({ doc, label }: { doc: IndexDoc; label: string }) {
  const className = useClassName('article');
  const { features, slots } = useOkfConfig();

  return (
    <DocProvider doc={doc}>
      <article className={className}>
        <header className="okf-index-header">
          <h1 className="okf-title">{label}</h1>
          {doc.frontmatter.description ? (
            <p className="okf-description">{doc.frontmatter.description}</p>
          ) : null}
        </header>
        <div className="okf-prose">
          <Markdown doc={doc} />
        </div>
        {features.backlinks ? <slots.Backlinks route={doc.route} /> : null}
      </article>
    </DocProvider>
  );
}

/** A directory with no `index.md`: SPEC §8 makes it optional, so synthesize the listing. */
export function DirectoryPage({ node }: { node: NavNode }) {
  const className = useClassName('article');
  return (
    <article className={className}>
      <header className="okf-index-header">
        <h1 className="okf-title">{node.label}</h1>
        {node.description ? <p className="okf-description">{node.description}</p> : null}
      </header>
      {node.children.length === 0 ? (
        <p className="okf-empty">This directory is empty.</p>
      ) : (
        <ul className="okf-listing">
          {node.children.map((child) => (
            <li key={child.route} className="okf-listing-item">
              <Link to={child.route} className="okf-link">
                {child.label}
              </Link>
              {child.description ? (
                <span className="okf-listing-description">{child.description}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** `log.md` (SPEC §9). */
export function LogPage({ doc }: { doc: LogDoc }) {
  const className = useClassName('article');
  return (
    <DocProvider doc={doc}>
      <article className={className}>
        <div className="okf-prose">
          <Markdown doc={doc} />
        </div>
      </article>
    </DocProvider>
  );
}

export function NotFound({ route }: { route: string }) {
  const className = useClassName('article');
  return (
    <article className={className}>
      <h1 className="okf-title">Not found</h1>
      <p className="okf-description">
        Nothing in this bundle is routed at <code>{route}</code>.
      </p>
      <p>
        <Link to="/" className="okf-link">
          Back to the bundle root
        </Link>
      </p>
    </article>
  );
}
