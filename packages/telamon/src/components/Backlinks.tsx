import { Link } from '../router/context.js';
import { useBacklinks, useClassName } from './context.js';

/** Concepts that link *to* this one — the reverse of the bundle's link graph. */
export function Backlinks({ route }: { route: string }) {
  const refs = useBacklinks(route);
  const className = useClassName('backlinks');
  if (refs.length === 0) return null;

  return (
    <section className={className} aria-labelledby="okf-backlinks-heading">
      <h2 id="okf-backlinks-heading" className="okf-section-heading">
        Referenced by
      </h2>
      <ul className="okf-backlink-list">
        {refs.map((ref) => (
          <li key={ref.route} className="okf-backlink">
            <Link to={ref.route} className="okf-link">
              {ref.title}
            </Link>
            {ref.type ? <span className="okf-badge okf-badge--type">{ref.type}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
