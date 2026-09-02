import type { Root as HastRoot } from 'hast';

/**
 * OKF actor convention (SPEC §7): `human:<id>`, `process:<id>`, or
 * `<producer>/<version>` for agents.
 */
export type ActorKind = 'human' | 'process' | 'agent';

export interface Actor {
  /** The string exactly as authored. */
  raw: string;
  kind: ActorKind;
  /** `alice` for `human:alice`; `reference_agent` for `reference_agent/gemini-3.5-flash`. */
  id: string;
  /** Only set for agent actors. */
  version?: string;
}

/** SPEC §5.4. Absent `status` means `stable`. */
export type OkfStatus = 'draft' | 'stable' | 'deprecated';

/** Derived by consumers from `verified` (SPEC §5.3). */
export type TrustTier = 'unverified' | 'machine-confirmed' | 'human-reviewed';

/** An entry of the `sources` frontmatter list (SPEC §5.1). */
export interface OkfSourceRef {
  /** Optional, but required to key `[^id]` footnotes to this entry. */
  id?: string;
  /** Required within an entry. */
  resource: string;
  title?: string;
  author?: string;
  usageCount?: number;
  /** ISO-8601, as authored. */
  lastModified?: string;
}

/** A `generated` or `verified` record. */
export interface Attestation {
  by?: Actor;
  /** ISO-8601, as authored. */
  at?: string;
}

/**
 * A typed edge declared in frontmatter, e.g. `A depends_on B`.
 *
 * Not part of the OKF spec, which gives cross-links no semantics of their own
 * (SPEC §6) -- but the spec forbids rejecting unknown frontmatter keys, so a
 * bundle is free to carry these and a consumer is free to use them.
 */
export interface Relationship {
  /** Kind as authored, e.g. `depends_on`. Not registered or validated. */
  type?: string;
  /** Target exactly as authored. */
  target: string;
  description?: string;
  /** Bundle-relative path of the target, for in-bundle targets. */
  path?: string;
  /** Route of the target, for in-bundle targets. */
  route?: string;
  external: boolean;
  /** True when an in-bundle target does not exist. */
  broken: boolean;
}

export interface UsageWindow {
  from?: string;
  to?: string;
}

/**
 * Normalized frontmatter. Every field is optional per SPEC §11 except that
 * `type` is required for conformance — a document missing it still parses and
 * renders, and produces a `missing-type` diagnostic instead.
 */
export interface OkfFrontmatter {
  type?: string;
  title?: string;
  description?: string;
  resource?: string;
  tags: string[];
  sources: OkfSourceRef[];
  /** `sources` indexed by `id`, for wiring `[^id]` footnotes. */
  sourcesById: Map<string, OkfSourceRef>;
  usageWindow?: UsageWindow;
  generated?: Attestation;
  /** A bare `verified` mapping is normalized to a one-element list (SPEC §11). */
  verified: Attestation[];
  status: OkfStatus;
  /** ISO-8601. Content is stale once `now >= staleAfter`. */
  staleAfter?: string;
  /** Only meaningful on the bundle-root `index.md` (SPEC §12). */
  okfVersion?: string;
  /** Typed edges from the non-standard `relationships` key, resolved against the bundle. */
  relationships: Relationship[];
  /** Every key exactly as authored, including ones this library does not model. */
  raw: Record<string, unknown>;
}

export type DocKind = 'concept' | 'index' | 'log';

export interface Heading {
  id: string;
  /** 1-6 */
  depth: number;
  text: string;
}

/** A link that appeared in a document body and pointed inside the bundle. */
export interface DocLink {
  /** Route of the target. */
  route: string;
  /** `#fragment`, without the hash, if the link had one. */
  fragment?: string;
  /** True when the target does not exist in the bundle. */
  broken: boolean;
}

interface DocBase {
  kind: DocKind;
  /** Bundle-relative POSIX path, e.g. `references/metrics/purchasers.md`. */
  filePath: string;
  /** Directory containing the file; `''` at the bundle root. */
  dir: string;
  /** Canonical, URL-decoded route. Always starts with `/`, never ends with one (except `/`). */
  route: string;
  /** File contents, verbatim. */
  source: string;
  /** Body with the frontmatter block removed. */
  body: string;
  /** Parsed, link-rewritten hast. Built once at parse time and reused for every render. */
  hast: HastRoot;
  headings: Heading[];
  /** Outgoing in-bundle links, in document order, de-duplicated by route. */
  links: DocLink[];
  /** Display title: frontmatter `title`, else the first heading, else the file stem. */
  title: string;
  frontmatter: OkfFrontmatter;
}

export interface ConceptDoc extends DocBase {
  kind: 'concept';
}

/** An entry parsed out of an `index.md` list (SPEC §8). */
export interface IndexEntry {
  label: string;
  /** The href exactly as authored. */
  href: string;
  /** Resolved route, absent when the target is external or unresolvable. */
  route?: string;
  description?: string;
  external: boolean;
}

export interface IndexDoc extends DocBase {
  kind: 'index';
  entries: IndexEntry[];
}

export interface LogDoc extends DocBase {
  kind: 'log';
}

export type OkfDoc = ConceptDoc | IndexDoc | LogDoc;

export interface DocRef {
  route: string;
  title: string;
  type?: string;
  /** Set when the reference came from a typed `relationships` entry rather than a body link. */
  relationship?: string;
}

export type NavNodeKind = 'concept' | 'directory' | 'log';

export interface NavNode {
  route: string;
  label: string;
  description?: string;
  kind: NavNodeKind;
  /** The document rendered at this route, absent for directories with no `index.md`. */
  doc?: OkfDoc;
  children: NavNode[];
}

export interface GraphNode {
  route: string;
  label: string;
  type?: string;
  kind: DocKind;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** Relationship type, when the edge came from a `relationships` entry. */
  type?: string;
  /** Typed relationships are directed; a plain body link carries no direction. */
  directed: boolean;
}

export type DiagnosticCode =
  | 'missing-type'
  | 'invalid-frontmatter'
  | 'frontmatter-on-reserved-file'
  | 'broken-link'
  | 'unresolved-index-entry'
  | 'route-collision'
  | 'unsupported-okf-version'
  | 'broken-relationship'
  | 'invalid-relationship';

export interface BundleDiagnostic {
  code: DiagnosticCode;
  severity: 'warning' | 'info';
  message: string;
  /** Bundle-relative path of the file the diagnostic concerns. */
  filePath?: string;
}

export interface Bundle {
  docs: OkfDoc[];
  byRoute: Map<string, OkfDoc>;
  byPath: Map<string, OkfDoc>;
  /** Directories that have no `index.md` and therefore render a synthesized listing. */
  directories: Map<string, NavNode>;
  /** Top-level navigation nodes. The bundle-root `index.md` is not among them. */
  tree: NavNode[];
  /** The bundle-root `index.md`, when present. */
  root?: IndexDoc;
  /** Route -> documents that link to it. */
  backlinks: Map<string, DocRef[]>;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  /** `okf_version` declared on the bundle-root `index.md`. */
  okfVersion?: string;
  diagnostics: BundleDiagnostic[];
  /** The input file map, kept so consumers can reach non-markdown assets. */
  files: Record<string, string>;
}
