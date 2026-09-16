import { createProcessor } from '../markdown/pipeline.js';
import { isMarkdownPath, normalizeFilePath } from './paths.js';
import {
  assembleBundle,
  parseDocument,
  resolveDocument,
  type DocumentContext,
  type ParseOptions,
} from './parse.js';
import type { Bundle, BundleDiagnostic, DiagnosticCode, GraphEdge, GraphNode, OkfDoc } from './types.js';

export interface BundleChanges {
  /** Files added or modified, as path to contents. */
  changed?: Record<string, string>;
  /** Files removed. */
  deleted?: string[];
}

/**
 * Diagnostics that depend only on a document's own text, and so survive a
 * change to any other file.
 *
 * Everything else -- a broken link, an unresolved index entry, a route
 * collision -- is a statement about the bundle rather than the document, and is
 * recomputed on every update.
 */
const OWN_CONTENT_CODES = new Set<DiagnosticCode>([
  'invalid-frontmatter',
  'missing-type',
  'frontmatter-on-reserved-file',
]);

/**
 * Diagnostics a document produces while resolving against the bundle.
 *
 * These depend on exactly one thing beyond the document itself: which files
 * exist. They survive a change to another document's *contents*, and not a
 * change to which documents there are.
 *
 * `route-collision`, `unresolved-index-entry` and `unsupported-okf-version` are
 * deliberately absent. Those are recomputed by `assembleBundle` on every
 * update, so carrying them forward would report each of them twice.
 */
const RESOLUTION_CODES = new Set<DiagnosticCode>([
  'broken-link',
  'broken-relationship',
  'invalid-relationship',
]);

const OWN_AND_RESOLUTION_CODES = new Set<DiagnosticCode>([
  ...OWN_CONTENT_CODES,
  ...RESOLUTION_CODES,
]);

function sameGraph(a: { nodes: GraphNode[]; edges: GraphEdge[] }, b: typeof a): boolean {
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
  for (const [i, node] of a.nodes.entries()) {
    const other = b.nodes[i]!;
    if (
      node.route !== other.route ||
      node.label !== other.label ||
      node.type !== other.type ||
      node.kind !== other.kind ||
      node.degree !== other.degree
    ) {
      return false;
    }
  }
  for (const [i, edge] of a.edges.entries()) {
    const other = b.edges[i]!;
    if (
      edge.source !== other.source ||
      edge.target !== other.target ||
      edge.type !== other.type ||
      edge.directed !== other.directed
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The files a change set actually costs a parse.
 *
 * A file reported as changed whose contents are identical needs no work, so a
 * source that cannot tell what changed can hand over everything and still pay
 * only for what differs. Shared with the caller that reports how much a
 * refresh cost: counting what the source offered rather than what was parsed
 * turns "reparsed 2000 files in 1.5s" into a line in a log, when 2000 files
 * take half a minute to parse and none of them were touched.
 */
export function filesToReparse(
  previousFiles: Record<string, string>,
  changed: Record<string, string>,
): Set<string> {
  return new Set(
    Object.keys(changed).filter(
      (path) => isMarkdownPath(path) && previousFiles[path] !== changed[path],
    ),
  );
}

/**
 * Re-read part of a bundle.
 *
 * Parsing markdown is what makes reading a bundle expensive, and it is
 * per-document: a document nothing touched parses to exactly what it parsed to
 * before. So this re-parses only the files that changed, reuses the rest, and
 * redoes the cheap work that depends on the whole -- link resolution, the
 * navigation tree, backlinks, the graph. On two thousand documents, ten changed
 * ones cost about twenty-five milliseconds where a full parse costs nearly
 * three seconds.
 *
 * The returned bundle is new; the one passed in is left untouched, so anything
 * still rendering from it stays consistent.
 */
export function updateBundle(
  previous: Bundle,
  changes: BundleChanges,
  options: ParseOptions = {},
): Bundle {
  const changed: Record<string, string> = {};
  for (const [rawPath, contents] of Object.entries(changes.changed ?? {})) {
    if (typeof contents !== 'string') {
      throw new TypeError(`File "${rawPath}" must be a string, received ${typeof contents}.`);
    }
    const filePath = normalizeFilePath(rawPath);
    if (filePath !== '') changed[filePath] = contents;
  }
  const deleted = new Set(
    (changes.deleted ?? []).map((path) => normalizeFilePath(path)).filter((path) => path !== ''),
  );

  const files: Record<string, string> = { ...previous.files };
  for (const path of deleted) delete files[path];
  Object.assign(files, changed);

  const reparse = filesToReparse(previous.files, changed);

  const markdownPaths = new Set(Object.keys(files).filter(isMarkdownPath));
  const hasFile = (path: string) => markdownPaths.has(path);

  /**
   * Whether the set of documents changed, as opposed to their contents.
   *
   * Resolution asks exactly one question about the rest of the bundle -- does
   * this file exist -- so an unchanged document resolves to what it already
   * resolved to unless a file arrived or left. Editing a body cannot break
   * anyone else's link; adding the file that link points at can fix it.
   *
   * `previous.byPath` holds precisely the markdown documents, so equal sizes
   * plus containment is set equality.
   */
  const membershipChanged =
    markdownPaths.size !== previous.byPath.size ||
    [...markdownPaths].some((path) => !previous.byPath.has(path));

  // Everything a document said about its own text still stands. What it said
  // about the bundle stands too, as long as the bundle still holds the same
  // documents -- otherwise it is dropped here and re-derived below.
  const keep = membershipChanged ? OWN_CONTENT_CODES : OWN_AND_RESOLUTION_CODES;
  const diagnostics: BundleDiagnostic[] = previous.diagnostics.filter(
    (diagnostic) =>
      keep.has(diagnostic.code) &&
      diagnostic.filePath !== undefined &&
      markdownPaths.has(diagnostic.filePath) &&
      !reparse.has(diagnostic.filePath),
  );

  const context: DocumentContext = { processor: createProcessor(options), hasFile, diagnostics };

  const docs: OkfDoc[] = [];
  const byPath = new Map<string, OkfDoc>();

  for (const filePath of [...markdownPaths].sort()) {
    const existing = previous.byPath.get(filePath);
    let doc: OkfDoc;
    if (existing === undefined || reparse.has(filePath)) {
      doc = parseDocument(filePath, files[filePath]!, context);
    } else if (membershipChanged) {
      doc = resolveDocument(existing, context);
    } else {
      // Nothing it could say about the bundle has changed, so it is still the
      // answer. Reused by identity, which is also what lets a consumer memoize
      // on the document it was handed.
      doc = existing;
    }
    docs.push(doc);
    byPath.set(filePath, doc);
  }

  const next = assembleBundle({ docs, byPath, files, diagnostics });

  // Hand back the previous graph object when the graph is unchanged. The
  // settled force layout is cached against that object's identity, and
  // re-settling it costs far more than everything above put together.
  return sameGraph(previous.graph, next.graph) ? { ...next, graph: previous.graph } : next;
}

/**
 * The difference between the files a bundle was built from and a fresh read of
 * them, for a source that cannot say what changed.
 */
export function diffFiles(previous: Record<string, string>, current: Record<string, string>): BundleChanges {
  const changed: Record<string, string> = {};
  for (const [path, contents] of Object.entries(current)) {
    if (previous[path] !== contents) changed[path] = contents;
  }
  const deleted = Object.keys(previous).filter((path) => !(path in current));
  return { changed, ...(deleted.length > 0 && { deleted }) };
}
