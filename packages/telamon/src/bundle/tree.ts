import { dirOf, reservedKindOf } from './paths.js';
import type { IndexDoc, NavNode, OkfDoc } from './types.js';

/** Last-resort label for a file or directory with no title: `n_day_users` -> `N Day Users`. */
export function humanize(segment: string): string {
  const words = segment.replace(/[_-]+/g, ' ').trim().split(/\s+/);
  return words
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

interface DirEntry {
  files: string[];
  subdirs: Set<string>;
}

function indexDocOf(byPath: Map<string, OkfDoc>, dir: string): IndexDoc | undefined {
  const doc = byPath.get(dir === '' ? 'index.md' : `${dir}/index.md`);
  return doc?.kind === 'index' ? doc : undefined;
}

export interface NavTree {
  tree: NavNode[];
  /** Every directory in the bundle, keyed by route, including the root. */
  directories: Map<string, NavNode>;
}

/**
 * Build the sidebar tree from the directory structure.
 *
 * Where a directory has an `index.md`, its link order and per-entry
 * descriptions win — that file is the bundle author's own statement of how the
 * directory should read. Everything else falls back to alphabetical order.
 */
export function buildNavTree(docs: OkfDoc[], byPath: Map<string, OkfDoc>): NavTree {
  const dirs = new Map<string, DirEntry>();
  const ensure = (dir: string): DirEntry => {
    let entry = dirs.get(dir);
    if (!entry) {
      entry = { files: [], subdirs: new Set() };
      dirs.set(dir, entry);
      if (dir !== '') {
        const parent = dirOf(dir);
        ensure(parent).subdirs.add(dir);
      }
    }
    return entry;
  };
  ensure('');

  for (const doc of docs) {
    const dir = doc.dir;
    ensure(dir).files.push(doc.filePath);
  }

  const directories = new Map<string, NavNode>();

  const build = (dir: string): NavNode[] => {
    const entry = dirs.get(dir);
    if (!entry) return [];

    const index = indexDocOf(byPath, dir);
    const order = new Map<string, number>();
    const described = new Map<string, string>();
    const labelled = new Map<string, string>();
    index?.entries.forEach((indexEntry, position) => {
      if (!indexEntry.route) return;
      if (!order.has(indexEntry.route)) order.set(indexEntry.route, position);
      if (indexEntry.description) described.set(indexEntry.route, indexEntry.description);
      if (indexEntry.label) labelled.set(indexEntry.route, indexEntry.label);
    });

    const nodes: NavNode[] = [];
    const claimed = new Set<string>();

    for (const subdir of entry.subdirs) {
      const route = `/${subdir}`;
      const subIndex = indexDocOf(byPath, subdir);
      const node: NavNode = {
        route,
        label:
          subIndex?.frontmatter.title ??
          labelled.get(route) ??
          humanize(subdir.slice(subdir.lastIndexOf('/') + 1)),
        kind: 'directory',
        children: build(subdir),
      };
      const description = described.get(route) ?? subIndex?.frontmatter.description;
      if (description) node.description = description;
      if (subIndex) node.doc = subIndex;
      directories.set(route, node);
      nodes.push(node);
      claimed.add(route);
    }

    for (const filePath of entry.files) {
      const reserved = reservedKindOf(filePath);
      if (reserved === 'index') continue;
      const doc = byPath.get(filePath);
      if (!doc) continue;
      // A directory and a same-named file collide on one route; the directory wins.
      if (claimed.has(doc.route)) continue;

      const node: NavNode = {
        route: doc.route,
        label: doc.frontmatter.title ?? labelled.get(doc.route) ?? doc.title,
        kind: reserved === 'log' ? 'log' : 'concept',
        doc,
        children: [],
      };
      const description = described.get(doc.route) ?? doc.frontmatter.description;
      if (description) node.description = description;
      nodes.push(node);
    }

    nodes.sort((a, b) => {
      const orderA = order.get(a.route);
      const orderB = order.get(b.route);
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      // Logs are chrome, not content: keep them last.
      const aIsLog = a.kind === 'log';
      const bIsLog = b.kind === 'log';
      if (aIsLog !== bIsLog) return aIsLog ? 1 : -1;
      return a.label.localeCompare(b.label);
    });

    return nodes;
  };

  const tree = build('');
  const rootIndex = indexDocOf(byPath, '');
  const rootNode: NavNode = {
    route: '/',
    label: rootIndex?.frontmatter.title ?? 'Home',
    kind: 'directory',
    children: tree,
  };
  if (rootIndex) rootNode.doc = rootIndex;
  directories.set('/', rootNode);

  return { tree, directories };
}

/** Ancestor chain from the bundle root down to (and including) `route`. */
export function breadcrumbTrail(route: string, resolve: (route: string) => NavNode | undefined) {
  const segments = route.split('/').filter(Boolean);
  const trail: { route: string; label: string }[] = [];
  const rootNode = resolve('/');
  trail.push({ route: '/', label: rootNode?.label ?? 'Home' });
  let current = '';
  for (const segment of segments) {
    current += `/${segment}`;
    const node = resolve(current);
    trail.push({ route: current, label: node?.label ?? humanize(segment) });
  }
  return trail;
}
