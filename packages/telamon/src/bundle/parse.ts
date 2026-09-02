import {
  collectHeadings,
  createProcessor,
  firstHeadingText,
  markdownToHast,
  type PipelineOptions,
} from '../markdown/pipeline.js';
import { collectLinks, parseIndexEntries } from './links.js';
import { parseFrontmatter } from './frontmatter.js';
import {
  dirOf,
  filePathToRoute,
  isMarkdownPath,
  normalizeFilePath,
  reservedKindOf,
  stemOf,
} from './paths.js';
import { buildNavTree, humanize } from './tree.js';
import type {
  Bundle,
  BundleDiagnostic,
  ConceptDoc,
  DocRef,
  GraphEdge,
  GraphNode,
  IndexDoc,
  LogDoc,
  OkfDoc,
} from './types.js';

/** OKF major version this library implements. */
export const SUPPORTED_OKF_MAJOR = 0;

export type ParseOptions = PipelineOptions;

function lastSegment(dir: string): string {
  return dir.slice(dir.lastIndexOf('/') + 1);
}

/**
 * Parse an in-memory OKF bundle.
 *
 * Content problems never throw. Per SPEC §11 a consumer must not reject a
 * bundle for unknown types, unknown keys, missing optional fields, broken
 * links, or a missing `index.md`; every such case becomes a diagnostic and the
 * document still renders. The only thrown error is for a malformed `files`
 * argument, which is a programming mistake rather than a content one.
 */
export function parseBundle(files: Record<string, string>, options: ParseOptions = {}): Bundle {
  if (typeof files !== 'object' || files === null || Array.isArray(files)) {
    throw new TypeError('parseBundle expects an object mapping bundle-relative paths to contents.');
  }

  const diagnostics: BundleDiagnostic[] = [];
  const normalizedFiles: Record<string, string> = {};
  const markdownPaths = new Set<string>();

  for (const [rawPath, contents] of Object.entries(files)) {
    if (typeof contents !== 'string') {
      throw new TypeError(`File "${rawPath}" must be a string, received ${typeof contents}.`);
    }
    const filePath = normalizeFilePath(rawPath);
    if (filePath === '') continue;
    normalizedFiles[filePath] = contents;
    if (isMarkdownPath(filePath)) markdownPaths.add(filePath);
  }

  const processor = createProcessor(options);
  const hasFile = (path: string) => markdownPaths.has(path);

  const docs: OkfDoc[] = [];
  const byPath = new Map<string, OkfDoc>();

  for (const filePath of [...markdownPaths].sort()) {
    const source = normalizedFiles[filePath]!;
    const reserved = reservedKindOf(filePath);
    const dir = dirOf(filePath);
    const route = filePathToRoute(filePath);

    const { frontmatter, body, present } = parseFrontmatter(source, filePath, diagnostics);

    if (reserved === null && frontmatter.type === undefined) {
      diagnostics.push({
        code: 'missing-type',
        severity: 'warning',
        filePath,
        message: 'Concept documents must declare a `type` in frontmatter (SPEC §11).',
      });
    }

    // Reserved files carry no frontmatter, except `okf_version` on the bundle root.
    if (reserved !== null && present) {
      const onlyOkfVersion =
        reserved === 'index' && dir === '' && Object.keys(frontmatter.raw).every((k) => k === 'okf_version');
      if (!onlyOkfVersion) {
        diagnostics.push({
          code: 'frontmatter-on-reserved-file',
          severity: 'info',
          filePath,
          message: `${filePath} is a reserved file and should not carry frontmatter (SPEC §3.1).`,
        });
      }
    }

    const hast = markdownToHast(processor, body);
    const headings = collectHeadings(hast);
    const links = collectLinks(hast, {
      dir,
      filePath,
      hasFile,
      diagnostics,
      reportBroken: reserved !== 'index',
    });

    const fallbackTitle =
      reserved === 'index'
        ? dir === ''
          ? 'Home'
          : humanize(lastSegment(dir))
        : reserved === 'log'
          ? 'Update log'
          : humanize(stemOf(filePath));
    const title = frontmatter.title ?? firstHeadingText(hast) ?? fallbackTitle;

    const base = { filePath, dir, route, source, body, hast, headings, links, title, frontmatter };

    if (reserved === 'index') {
      const doc: IndexDoc = {
        ...base,
        kind: 'index',
        entries: parseIndexEntries(hast, dir, hasFile),
      };
      docs.push(doc);
      byPath.set(filePath, doc);
    } else if (reserved === 'log') {
      const doc: LogDoc = { ...base, kind: 'log' };
      docs.push(doc);
      byPath.set(filePath, doc);
    } else {
      const doc: ConceptDoc = { ...base, kind: 'concept' };
      docs.push(doc);
      byPath.set(filePath, doc);
    }
  }

  for (const doc of docs) {
    if (doc.kind !== 'index') continue;
    for (const entry of doc.entries) {
      if (entry.external || entry.route) continue;
      diagnostics.push({
        code: 'unresolved-index-entry',
        severity: 'warning',
        filePath: doc.filePath,
        message: `Index entry "${entry.label}" points at "${entry.href}", which is not in the bundle.`,
      });
    }
  }

  // Index documents claim their route first: when `foo/index.md` and `foo.md`
  // both exist they collide, and the directory is the more useful landing page.
  const byRoute = new Map<string, OkfDoc>();
  for (const doc of [...docs].sort((a, b) => Number(b.kind === 'index') - Number(a.kind === 'index'))) {
    const existing = byRoute.get(doc.route);
    if (existing) {
      diagnostics.push({
        code: 'route-collision',
        severity: 'warning',
        filePath: doc.filePath,
        message: `"${doc.filePath}" and "${existing.filePath}" both map to ${doc.route}; "${existing.filePath}" wins.`,
      });
      continue;
    }
    byRoute.set(doc.route, doc);
  }

  const { tree, directories } = buildNavTree(docs, byPath);

  const backlinks = new Map<string, DocRef[]>();
  const edges: GraphEdge[] = [];
  const degrees = new Map<string, number>();
  const bump = (route: string) => degrees.set(route, (degrees.get(route) ?? 0) + 1);

  for (const doc of docs) {
    for (const link of doc.links) {
      if (link.broken || link.route === doc.route) continue;
      const target = byRoute.get(link.route);
      if (!target) continue;

      const refs = backlinks.get(link.route) ?? [];
      if (!refs.some((ref) => ref.route === doc.route)) {
        const ref: DocRef = { route: doc.route, title: doc.title };
        if (doc.frontmatter.type) ref.type = doc.frontmatter.type;
        refs.push(ref);
      }
      backlinks.set(link.route, refs);

      edges.push({ source: doc.route, target: link.route });
      bump(doc.route);
      bump(link.route);
    }
  }

  const nodes: GraphNode[] = [...byRoute.values()].map((doc) => {
    const node: GraphNode = {
      route: doc.route,
      label: doc.title,
      kind: doc.kind,
      degree: degrees.get(doc.route) ?? 0,
    };
    if (doc.frontmatter.type) node.type = doc.frontmatter.type;
    return node;
  });

  const root = byPath.get('index.md');
  const rootIndex = root?.kind === 'index' ? root : undefined;
  const okfVersion = rootIndex?.frontmatter.okfVersion;
  if (okfVersion !== undefined) {
    const major = Number.parseInt(okfVersion, 10);
    if (Number.isNaN(major) || major !== SUPPORTED_OKF_MAJOR) {
      diagnostics.push({
        code: 'unsupported-okf-version',
        severity: 'info',
        filePath: 'index.md',
        message: `Bundle declares okf_version ${okfVersion}; this renderer implements ${SUPPORTED_OKF_MAJOR}.x.`,
      });
    }
  }

  return {
    docs,
    byRoute,
    byPath,
    directories,
    tree,
    ...(rootIndex && { root: rootIndex }),
    backlinks,
    graph: { nodes, edges },
    ...(okfVersion !== undefined && { okfVersion }),
    diagnostics,
    files: normalizedFiles,
  };
}

/** Duck-type check so `OkfSite` can accept either a parsed bundle or a raw file map. */
export function isBundle(value: unknown): value is Bundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Bundle).docs) &&
    (value as Bundle).byRoute instanceof Map
  );
}
