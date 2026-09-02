import type { Bundle, NavNode, OkfDoc } from './types.js';

/** Directory name whose contents the default predicate treats as provenance-only. */
export const REFERENCE_DIRECTORY = 'references';

/**
 * The default rule for "this concept exists only to hold source provenance":
 * it lives under a `references/` directory, at any depth.
 *
 * Bundles vary, so this is only a default — `OkfSite`'s `isReference` prop
 * replaces it wholesale (match on `type`, on a tag, on a name list, whatever
 * the bundle actually uses).
 */
export function isReferenceDoc(doc: OkfDoc): boolean {
  return doc.dir
    .split('/')
    .some((segment) => segment.toLowerCase() === REFERENCE_DIRECTORY);
}

/**
 * Routes to hide while references are toggled off.
 *
 * Built from `byRoute` rather than `docs` so a document that lost a route
 * collision cannot hide the route it does not own.
 */
export function referenceRoutes(
  bundle: Bundle,
  isReference: (doc: OkfDoc) => boolean = isReferenceDoc,
): Set<string> {
  const routes = new Set<string>();
  for (const doc of bundle.byRoute.values()) if (isReference(doc)) routes.add(doc.route);
  return routes;
}

/**
 * Drop hidden routes from a navigation tree, and prune directories left with
 * nothing to show.
 *
 * Nodes that survive unchanged are returned by identity, so React keeps its
 * subtrees when the toggle does not affect a branch.
 */
export function filterNavTree(nodes: NavNode[], hidden: ReadonlySet<string>): NavNode[] {
  if (hidden.size === 0) return nodes;

  const visit = (node: NavNode): NavNode | null => {
    if (hidden.has(node.route)) return null;

    const children = node.children
      .map(visit)
      .filter((child): child is NavNode => child !== null);

    // A directory with no page of its own and nothing left inside goes too.
    if (node.children.length > 0 && children.length === 0 && !node.doc) return null;

    return children.length === node.children.length ? node : { ...node, children };
  };

  return nodes.map(visit).filter((node): node is NavNode => node !== null);
}
