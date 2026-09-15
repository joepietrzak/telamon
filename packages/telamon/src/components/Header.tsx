import { Link } from '../router/context.js';
import { useClassName, useOkfConfig } from './context.js';
import type { HeaderProps } from './slots.js';

/** Site title, search, the graph link, and the source download. */
export function Header({ title }: HeaderProps) {
  const className = useClassName('header');
  const titleClassName = useClassName('headerTitle');
  const { features, graphRoute, slots } = useOkfConfig();

  return (
    <header className={className}>
      <Link to="/" className={titleClassName}>
        {title}
      </Link>
      <div className="okf-header-actions">
        {features.search ? <slots.SearchBox /> : null}
        {features.graph ? (
          <Link to={graphRoute} className="okf-header-link">
            Graph
          </Link>
        ) : null}
        {features.download ? <slots.Download /> : null}
      </div>
    </header>
  );
}
