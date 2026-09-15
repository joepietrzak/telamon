import { filterNavTree, referenceRoutes } from '../bundle/references.js';
import type { Bundle, NavNode, OkfDoc } from '../bundle/types.js';

/** One level of the tree, as the enhancement script needs it. */
export interface NavChild {
  route: string;
  label: string;
  kind: NavNode['kind'];
  description?: string;
  /** Whether this one can be expanded in turn. */
  children: boolean;
}

function find(nodes: NavNode[], route: string): NavNode | undefined {
  for (const node of nodes) {
    if (node.route === route) return node;
    // Only descend where the route could be: the tree mirrors the paths.
    if (route.startsWith(`${node.route}/`)) {
      const found = find(node.children, route);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * The children of one navigation node.
 *
 * The sidebar renders only the branch containing the current page, which keeps
 * a page small but leaves every other directory closed with nothing behind it.
 * This is what the expand control fetches.
 */
export function navChildren(
  bundle: Bundle,
  route: string,
  options: { showReferences?: boolean; isReference?: (doc: OkfDoc) => boolean } = {},
): NavChild[] | undefined {
  const { showReferences = true, isReference } = options;
  const hidden = showReferences ? undefined : referenceRoutes(bundle, isReference);
  const tree = hidden && hidden.size > 0 ? filterNavTree(bundle.tree, hidden) : bundle.tree;

  // `/` is the tree itself rather than a node in it: the bundle root's own
  // index is not among the top-level nodes, so there is nothing to find.
  const children = route === '/' ? tree : find(tree, route)?.children;
  if (!children) return undefined;

  return children.map((child) => ({
    route: child.route,
    label: child.label,
    kind: child.kind,
    ...(child.description !== undefined && { description: child.description }),
    children: child.children.length > 0,
  }));
}
