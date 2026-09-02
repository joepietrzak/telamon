import { parse as parseYaml } from 'yaml';
import type {
  Actor,
  Attestation,
  BundleDiagnostic,
  OkfFrontmatter,
  OkfSourceRef,
  OkfStatus,
  TrustTier,
  UsageWindow,
} from './types.js';

const FENCE = /^---[ \t]*\r?\n/;

export interface SplitResult {
  /** The YAML text between the fences, or `null` when there is no frontmatter block. */
  data: string | null;
  /** Everything after the closing fence (or the whole file when there is none). */
  body: string;
}

/**
 * Split a leading `---` fenced YAML block off a markdown file.
 *
 * Done by hand rather than with `remark-frontmatter` because the data is needed
 * outside the markdown pipeline (routing, nav, search, metadata chrome).
 */
export function splitFrontmatter(input: string): SplitResult {
  const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const match = FENCE.exec(source);
  if (!match) return { data: null, body: source };
  const rest = source.slice(match[0].length);
  const close = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!close || close.index === undefined) return { data: null, body: source };
  return {
    data: rest.slice(0, close.index),
    body: rest.slice(close.index + close[0].length),
  };
}

/** SPEC §7. Unrecognized shapes fall back to an agent actor carrying the raw string. */
export function parseActor(raw: unknown): Actor | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const value = raw.trim();
  if (value.startsWith('human:')) return { raw: value, kind: 'human', id: value.slice(6) };
  if (value.startsWith('process:')) return { raw: value, kind: 'process', id: value.slice(8) };
  const slash = value.indexOf('/');
  if (slash !== -1) {
    return {
      raw: value,
      kind: 'agent',
      id: value.slice(0, slash),
      version: value.slice(slash + 1),
    };
  }
  return { raw: value, kind: 'agent', id: value };
}

export function formatActor(actor: Actor): string {
  return actor.kind === 'agent' && actor.version ? `${actor.id} (${actor.version})` : actor.id;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // A bare `at: 2026-07-10` parses to a Date under YAML 1.1-style timestamps.
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asString).filter((v): v is string => v !== undefined);
  const single = asString(value);
  return single === undefined ? [] : [single];
}

function toAttestation(value: unknown): Attestation | undefined {
  const record = asRecord(value);
  if (!record) {
    // Tolerate `generated: some-actor`.
    const actor = parseActor(value);
    return actor ? { by: actor } : undefined;
  }
  return { by: parseActor(record.by), at: asString(record.at) };
}

/** SPEC §11: a bare `verified` mapping is a one-element list. */
export function normalizeVerified(value: unknown): Attestation[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map(toAttestation).filter((v): v is Attestation => v !== undefined);
}

function toSource(value: unknown): OkfSourceRef | undefined {
  const asPlain = asString(value);
  if (asPlain !== undefined) return { resource: asPlain };
  const record = asRecord(value);
  if (!record) return undefined;
  const resource = asString(record.resource);
  const usageCount = record.usage_count;
  const source: OkfSourceRef = { resource: resource ?? '' };
  const id = asString(record.id);
  const title = asString(record.title);
  const author = asString(record.author);
  const lastModified = asString(record.last_modified);
  if (id !== undefined) source.id = id;
  if (title !== undefined) source.title = title;
  if (author !== undefined) source.author = author;
  if (lastModified !== undefined) source.lastModified = lastModified;
  if (typeof usageCount === 'number') source.usageCount = usageCount;
  return source;
}

function toUsageWindow(value: unknown): UsageWindow | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const from = asString(record.from);
  const to = asString(record.to);
  if (from === undefined && to === undefined) return undefined;
  return { ...(from !== undefined && { from }), ...(to !== undefined && { to }) };
}

const STATUSES: readonly OkfStatus[] = ['draft', 'stable', 'deprecated'];

function toStatus(value: unknown): OkfStatus {
  const raw = asString(value)?.toLowerCase();
  return STATUSES.includes(raw as OkfStatus) ? (raw as OkfStatus) : 'stable';
}

export function emptyFrontmatter(): OkfFrontmatter {
  return {
    tags: [],
    sources: [],
    sourcesById: new Map(),
    verified: [],
    status: 'stable',
    relationships: [],
    raw: {},
  };
}

export interface ParseFrontmatterResult {
  frontmatter: OkfFrontmatter;
  body: string;
  /** True when a `---` block was present, whether or not it parsed. */
  present: boolean;
}

/**
 * Parse and normalize frontmatter. Never throws on bad content: unparseable
 * YAML produces a diagnostic and an empty frontmatter, and unmodeled keys are
 * preserved on `raw` (SPEC §11 forbids rejecting unknown keys).
 */
export function parseFrontmatter(
  source: string,
  filePath: string,
  diagnostics: BundleDiagnostic[],
): ParseFrontmatterResult {
  const { data, body } = splitFrontmatter(source);
  if (data === null) return { frontmatter: emptyFrontmatter(), body, present: false };

  let parsed: unknown;
  try {
    parsed = parseYaml(data);
  } catch (error) {
    diagnostics.push({
      code: 'invalid-frontmatter',
      severity: 'warning',
      filePath,
      message: `Could not parse YAML frontmatter: ${(error as Error).message}`,
    });
    return { frontmatter: emptyFrontmatter(), body, present: true };
  }

  const record = asRecord(parsed);
  if (!record) {
    if (parsed !== null && parsed !== undefined) {
      diagnostics.push({
        code: 'invalid-frontmatter',
        severity: 'warning',
        filePath,
        message: 'Frontmatter is not a YAML mapping.',
      });
    }
    return { frontmatter: emptyFrontmatter(), body, present: true };
  }

  const sources = (Array.isArray(record.sources) ? record.sources : [])
    .map(toSource)
    .filter((s): s is OkfSourceRef => s !== undefined);
  const sourcesById = new Map<string, OkfSourceRef>();
  for (const source of sources) if (source.id) sourcesById.set(source.id, source);

  const frontmatter: OkfFrontmatter = {
    type: asString(record.type),
    title: asString(record.title),
    description: asString(record.description),
    resource: asString(record.resource),
    tags: asStringArray(record.tags),
    sources,
    sourcesById,
    usageWindow: toUsageWindow(record.usage_window),
    generated: toAttestation(record.generated),
    verified: normalizeVerified(record.verified),
    status: toStatus(record.status),
    staleAfter: asString(record.stale_after),
    okfVersion: asString(record.okf_version),
    // Resolved in parseBundle, which is where the file set is known.
    relationships: [],
    raw: record,
  };

  return { frontmatter, body, present: true };
}

/** SPEC §5.3. */
export function trustTierOf(frontmatter: OkfFrontmatter): TrustTier {
  if (frontmatter.verified.length === 0) return 'unverified';
  return frontmatter.verified.some((entry) => entry.by?.kind === 'human')
    ? 'human-reviewed'
    : 'machine-confirmed';
}

/** SPEC §5.5. An unparseable `stale_after` is treated as not stale. */
export function isStale(frontmatter: OkfFrontmatter, now: Date = new Date()): boolean {
  if (!frontmatter.staleAfter) return false;
  const deadline = Date.parse(frontmatter.staleAfter);
  return Number.isNaN(deadline) ? false : now.getTime() >= deadline;
}
