import { visit } from 'unist-util-visit';
import type { Element, Root as HastRoot } from 'hast';
import { classifyHref } from './paths.js';
import { toText } from '../markdown/pipeline.js';
import type { BundleDiagnostic, DocLink, IndexEntry } from './types.js';

function hrefOf(node: Element): string | undefined {
  const href = node.properties?.href;
  return typeof href === 'string' ? href : undefined;
}

export interface CollectLinksContext {
  /** Directory of the document being walked, used to resolve relative hrefs. */
  dir: string;
  filePath: string;
  hasFile(path: string): boolean;
  diagnostics: BundleDiagnostic[];
  /**
   * Whether to emit a `broken-link` diagnostic. Index files report the same
   * problem as `unresolved-index-entry`, which names the entry, so they opt out
   * rather than reporting each dangling target twice.
   */
  reportBroken?: boolean;
}

/**
 * Walk a document's links to find the ones that point inside the bundle.
 *
 * The tree is left untouched: rendering re-classifies each href against the
 * same directory, so there is a single source of truth for what a link means
 * and no rewritten state to keep in sync.
 */
export function collectLinks(tree: HastRoot, context: CollectLinksContext): DocLink[] {
  const links: DocLink[] = [];
  const seen = new Set<string>();

  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'a') return;
    const href = hrefOf(node);
    if (href === undefined) return;

    const resolved = classifyHref(href, context.dir);
    if (resolved.kind !== 'document' || !resolved.route || !resolved.path) return;

    const broken = !context.hasFile(resolved.path);
    if (broken && context.reportBroken !== false) {
      context.diagnostics.push({
        code: 'broken-link',
        severity: 'warning',
        filePath: context.filePath,
        message: `Link to "${href}" resolves to "${resolved.path}", which is not in the bundle.`,
      });
    }

    if (seen.has(resolved.route)) return;
    seen.add(resolved.route);
    links.push({
      route: resolved.route,
      ...(resolved.fragment !== undefined && { fragment: resolved.fragment }),
      broken,
    });
  });

  return links;
}

const LEADING_SEPARATOR = /^[\s]*[-–—:•]\s*/;

/**
 * Pull entries out of an `index.md` list (SPEC §8):
 * `* [Title](path) - description from the linked concept`.
 *
 * The link order in an index file is the authored navigation order, so this
 * doubles as the ordering signal for the sidebar.
 */
export function parseIndexEntries(
  tree: HastRoot,
  dir: string,
  hasFile: (path: string) => boolean,
): IndexEntry[] {
  const entries: IndexEntry[] = [];

  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'li') return;

    let anchor: Element | undefined;
    visit(node, 'element', (child: Element) => {
      if (anchor === undefined && child.tagName === 'a') anchor = child;
    });
    if (!anchor) return;

    const href = hrefOf(anchor);
    if (href === undefined) return;

    const label = toText(anchor).trim();
    const full = toText(node).trim();
    const description = full.startsWith(label)
      ? full.slice(label.length).replace(LEADING_SEPARATOR, '').trim()
      : '';

    const resolved = classifyHref(href, dir);
    const entry: IndexEntry = {
      label,
      href,
      external: resolved.kind === 'external',
    };
    if (description) entry.description = description;
    if (resolved.kind === 'document' && resolved.path && hasFile(resolved.path)) {
      entry.route = resolved.route;
    }
    entries.push(entry);
  });

  return entries;
}
