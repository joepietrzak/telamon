import type { ConceptDoc, Relationship } from '../bundle/types.js';
import { Link } from '../router/context.js';
import { useClassName } from './context.js';

/** `depends_on` -> `depends on`, for display only; the raw value stays in the data. */
export function formatRelationshipType(type: string | undefined): string {
  return type ? type.replace(/[_-]+/g, ' ') : 'related to';
}

function Target({ relationship }: { relationship: Relationship }) {
  if (relationship.external) {
    return (
      <a
        className="okf-link okf-link--external"
        href={relationship.target}
        target="_blank"
        rel="noreferrer noopener"
      >
        {relationship.target}
      </a>
    );
  }

  if (relationship.broken || !relationship.route) {
    return (
      <span
        className="okf-link okf-link--broken"
        title={`"${relationship.target}" does not resolve inside this bundle.`}
      >
        {relationship.target}
      </span>
    );
  }

  return (
    <Link to={relationship.route} className="okf-link">
      {relationship.target}
    </Link>
  );
}

/**
 * Typed edges declared in the non-standard `relationships` frontmatter.
 *
 * OKF links are untyped by design (SPEC §6), so a bundle that wants to say
 * *how* two concepts relate has to put it in frontmatter. When it does, that is
 * worth showing on the page and not only in the graph.
 */
export function Relationships({ doc }: { doc: ConceptDoc }) {
  const className = useClassName('relationships');
  const { relationships } = doc.frontmatter;
  if (relationships.length === 0) return null;

  return (
    <section className={className} aria-labelledby="okf-relationships-heading">
      <h2 id="okf-relationships-heading" className="okf-section-heading">
        Relationships
      </h2>
      <ul className="okf-relationship-list">
        {relationships.map((relationship, index) => (
          <li key={`${relationship.type ?? ''}-${relationship.target}-${index}`} className="okf-relationship">
            <span className="okf-relationship-type" data-okf-relationship={relationship.type}>
              {formatRelationshipType(relationship.type)}
            </span>
            <Target relationship={relationship} />
            {relationship.description ? (
              <span className="okf-relationship-description">{relationship.description}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
