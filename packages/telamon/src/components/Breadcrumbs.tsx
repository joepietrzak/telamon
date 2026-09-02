import { breadcrumbTrail } from '../bundle/tree.js';
import type { NavNode } from '../bundle/types.js';
import { Link } from '../router/context.js';
import { useClassName, useOkfBundle } from './context.js';

/** Ancestor trail for the current route, built from the same directory tree as the nav. */
export function Breadcrumbs({ route }: { route: string }) {
  const bundle = useOkfBundle();
  const className = useClassName('breadcrumbs');

  const resolve = (target: string): NavNode | undefined => {
    const directory = bundle.directories.get(target);
    if (directory) return directory;
    const doc = bundle.byRoute.get(target);
    return doc ? { route: target, label: doc.title, kind: 'concept', doc, children: [] } : undefined;
  };

  const trail = breadcrumbTrail(route, resolve);
  if (trail.length <= 1) return null;

  return (
    <nav className={className} aria-label="Breadcrumb">
      <ol className="okf-breadcrumb-list">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={crumb.route} className="okf-breadcrumb">
              {last ? (
                <span aria-current="page">{crumb.label}</span>
              ) : (
                <Link to={crumb.route} className="okf-link">
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
