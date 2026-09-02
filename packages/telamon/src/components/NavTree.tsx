import { useState } from 'react';
import type { NavNode } from '../bundle/types.js';
import { Link, useRoute } from '../router/context.js';
import { useClassName } from './context.js';

function containsRoute(node: NavNode, route: string): boolean {
  return route === node.route || route.startsWith(`${node.route}/`);
}

interface NavItemProps {
  node: NavNode;
  route: string;
  depth: number;
  expanded: Record<string, boolean>;
  toggle: (route: string) => void;
  linkClassName: string;
}

function NavItem({ node, route, depth, expanded, toggle, linkClassName }: NavItemProps) {
  const active = node.route === route;
  const hasChildren = node.children.length > 0;
  // Branches containing the current page start open; anything else remembers
  // whatever the reader last chose.
  const open = expanded[node.route] ?? containsRoute(node, route);

  return (
    <li className="okf-nav-item" data-okf-depth={depth} data-okf-kind={node.kind}>
      <div className="okf-nav-row">
        {hasChildren ? (
          <button
            type="button"
            className="okf-nav-toggle"
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${node.label}`}
            onClick={() => toggle(node.route)}
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </button>
        ) : (
          <span className="okf-nav-toggle okf-nav-toggle--empty" aria-hidden="true" />
        )}
        <Link
          to={node.route}
          className={`${linkClassName}${active ? ' okf-nav-link--active' : ''}`}
          title={node.description}
        >
          {node.label}
        </Link>
      </div>
      {hasChildren && open ? (
        <ul className="okf-nav-list">
          {node.children.map((child) => (
            <NavItem
              key={child.route}
              node={child}
              route={route}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              linkClassName={linkClassName}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** The directory structure, rendered as the site navigation. */
export function NavTree({ nodes }: { nodes: NavNode[] }) {
  const { route } = useRoute();
  const navClassName = useClassName('nav');
  const linkClassName = useClassName('navLink');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (target: string) =>
    setExpanded((current) => ({
      ...current,
      [target]: !(current[target] ?? (route === target || route.startsWith(`${target}/`))),
    }));

  return (
    <nav className={navClassName} aria-label="Bundle contents">
      <ul className="okf-nav-list okf-nav-list--root">
        {nodes.map((node) => (
          <NavItem
            key={node.route}
            node={node}
            route={route}
            depth={0}
            expanded={expanded}
            toggle={toggle}
            linkClassName={linkClassName}
          />
        ))}
      </ul>
    </nav>
  );
}
