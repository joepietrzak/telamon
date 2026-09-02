import { classifyHref, filePathToRoute } from './paths.js';
import type { BundleDiagnostic, Relationship } from './types.js';

/**
 * The non-standard `relationships` frontmatter key.
 *
 * OKF gives cross-links no semantics of their own — "all links assert untyped
 * relationships; semantics appear in the surrounding prose" (SPEC §6). A bundle
 * that wants typed edges can carry them in frontmatter instead, which §11
 * explicitly permits: a consumer must not reject a bundle for keys it does not
 * model. Shape:
 *
 * ```yaml
 * relationships:
 *   - type: depends_on
 *     target: /tables/events_.md
 *     description: Reads the raw event stream.
 * ```
 *
 * Targets take the same three forms as OKF cross-links — bundle-absolute,
 * explicitly relative, and bare relative — so they resolve through exactly the
 * same code path as a link in the body.
 */
export const RELATIONSHIPS_KEY = 'relationships';

interface RawRelationship {
  type?: string;
  target: string;
  description?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Pull well-formed entries out of the raw frontmatter value, reporting the rest. */
export function readRawRelationships(
  raw: unknown,
  filePath: string,
  diagnostics: BundleDiagnostic[],
): RawRelationship[] {
  if (raw === undefined || raw === null) return [];

  if (!Array.isArray(raw)) {
    diagnostics.push({
      code: 'invalid-relationship',
      severity: 'warning',
      filePath,
      message: '`relationships` must be a list of entries.',
    });
    return [];
  }

  const entries: RawRelationship[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      diagnostics.push({
        code: 'invalid-relationship',
        severity: 'warning',
        filePath,
        message: `relationships[${index}] must be a mapping.`,
      });
      return;
    }

    const record = entry as Record<string, unknown>;
    const target = asString(record.target);
    if (target === undefined) {
      diagnostics.push({
        code: 'invalid-relationship',
        severity: 'warning',
        filePath,
        message: `relationships[${index}] has no \`target\`.`,
      });
      return;
    }

    const type = asString(record.type);
    const description = asString(record.description);
    entries.push({
      ...(type !== undefined && { type }),
      target,
      ...(description !== undefined && { description }),
    });
  });

  return entries;
}

export interface ResolveRelationshipsContext {
  /** Directory of the declaring document, for relative targets. */
  dir: string;
  filePath: string;
  hasFile(path: string): boolean;
  diagnostics: BundleDiagnostic[];
}

/** Resolve each target against the bundle, reporting the ones that point nowhere. */
export function resolveRelationships(
  entries: RawRelationship[],
  context: ResolveRelationshipsContext,
): Relationship[] {
  return entries.map((entry) => {
    const resolved = classifyHref(entry.target, context.dir);

    if (resolved.kind === 'external') {
      return { ...entry, external: true, broken: false };
    }

    // A target with no `.md` extension is read as a route rather than a file,
    // so `relationships` can point at a directory index the way a reader would.
    const path =
      resolved.kind === 'document' && resolved.path
        ? resolved.path
        : resolved.path
          ? `${resolved.path}.md`
          : undefined;

    if (path === undefined) {
      return { ...entry, external: false, broken: true };
    }

    const indexPath = path.replace(/\.md$/i, '/index.md');
    const actual = context.hasFile(path) ? path : context.hasFile(indexPath) ? indexPath : undefined;

    if (actual === undefined) {
      context.diagnostics.push({
        code: 'broken-relationship',
        severity: 'warning',
        filePath: context.filePath,
        message: `Relationship${entry.type ? ` \`${entry.type}\`` : ''} targets "${entry.target}", which is not in the bundle.`,
      });
      return { ...entry, external: false, broken: true };
    }

    return {
      ...entry,
      path: actual,
      route: filePathToRoute(actual),
      external: false,
      broken: false,
    };
  });
}
