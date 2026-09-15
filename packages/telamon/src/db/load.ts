import { parseDbConfig, type DbConfig, type Row, type TableMapping } from './config.js';
import type { SourceCursor } from '../source/types.js';
import { rowsToFiles, type DbDiagnostic, type MappedBundle } from './mapping.js';

/**
 * Whatever a driver hands back: an array of rows, or a result object holding
 * one. Accepting both means `pool.query` can be passed straight through for the
 * drivers that wrap results, and `.rows` unwrapped for the ones that do not.
 */
export type QueryResult = Row[] | { rows: Row[] };

/**
 * The seam between telamon and your database.
 *
 * telamon never opens a connection, never learns a dialect, and never sees a
 * credential -- it hands you SQL and takes rows back, so the pool, retries,
 * timeouts, and observability stay where they already are.
 */
export type QueryFn = (sql: string, params: unknown[]) => QueryResult | Promise<QueryResult>;

/** The statement a mapping runs. Exported so a config can be checked without a database. */
export function buildStatement(mapping: TableMapping): string {
  if (mapping.sql !== undefined) return mapping.sql;

  // `select *` rather than the named columns: a mapping reads columns from four
  // places (path, title, body, frontmatter) and a projection that fell out of
  // step with one of them would fail as a missing column at render time.
  const parts = [`select * from ${mapping.table}`];
  if (mapping.where !== undefined) parts.push(`where ${mapping.where}`);
  if (mapping.orderBy !== undefined) parts.push(`order by ${mapping.orderBy}`);
  if (mapping.limit !== undefined) parts.push(`limit ${mapping.limit}`);
  return parts.join(' ');
}

function toRows(result: QueryResult, statement: string): Row[] {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray((result as { rows: Row[] }).rows)) {
    return (result as { rows: Row[] }).rows;
  }
  throw new TypeError(
    `The query function returned neither an array of rows nor a { rows } result for: ${statement}`,
  );
}

/**
 * Read a bundle out of a database.
 *
 * ```ts
 * const { files } = await loadBundle(config, (sql, params) => pool.query(sql, params));
 * // -> <OkfSite bundle={files} />
 * ```
 *
 * Node-side by design: the file map it produces is the same shape `OkfSite`
 * already takes, so everything downstream -- routing, search, the graph, the
 * source download -- works on a database-backed bundle exactly as on a
 * checked-in one.
 */
export async function loadBundle(
  /** A `DbConfig`, or the JSON you parsed out of a file. Validated either way. */
  config: DbConfig | unknown,
  query: QueryFn,
): Promise<MappedBundle> {
  const parsed = parseDbConfig(config);

  // In parallel: a loader on a request path pays the slowest table, not the sum.
  const results = await Promise.all(
    parsed.tables.map(async (mapping) => {
      const statement = buildStatement(mapping);
      return toRows(await query(statement, []), statement);
    }),
  );

  return rowsToFiles(parsed, results);
}

/**
 * How this engine writes a bound parameter.
 *
 * There is no portable answer -- `?` for SQLite and MySQL, `$1` for Postgres,
 * `@p1` for SQL Server -- and telamon has no way to know which it is talking
 * to. Defaults to `?`.
 */
export type Placeholder = (index: number) => string;

const QUESTION_MARK: Placeholder = () => '?';

/** True when every mapping can say what changed, which is what `loadChanged` needs. */
export function tracksChanges(config: DbConfig): boolean {
  return config.tables.length > 0 && config.tables.every((m) => m.changedColumn !== undefined);
}

/**
 * The statement for one mapping's changes since a cursor.
 *
 * Exported so a config can be checked, and read, without a database.
 */
export function buildChangedStatement(
  mapping: TableMapping,
  placeholder: Placeholder = QUESTION_MARK,
): string {
  const conditions = [
    ...(mapping.where !== undefined ? [`(${mapping.where})`] : []),
    `${mapping.changedColumn} > ${placeholder(1)}`,
  ];
  const parts = [`select * from ${mapping.table}`, `where ${conditions.join(' and ')}`];
  if (mapping.orderBy !== undefined) parts.push(`order by ${mapping.orderBy}`);
  if (mapping.limit !== undefined) parts.push(`limit ${mapping.limit}`);
  return parts.join(' ');
}

/** The furthest-forward value seen, which is where the next read resumes. */
function advance(current: SourceCursor, rows: Row[], column: string): SourceCursor {
  let cursor = current;
  for (const row of rows) {
    const value = row[column];
    const normalized =
      value instanceof Date ? value.toISOString() : typeof value === 'number' ? value : String(value ?? '');
    if (normalized > cursor) cursor = normalized;
  }
  return cursor;
}

export interface ChangedBundle {
  /** Documents whose rows changed. Never index files -- see below. */
  files: Record<string, string>;
  diagnostics: DbDiagnostic[];
  cursor: SourceCursor;
}

/**
 * Read the documents whose rows changed since a cursor.
 *
 * Two things this deliberately does not do, both of which need to be read
 * together with `loadBundle`.
 *
 * It does not regenerate the synthesized `index.md` files. Those are built from
 * every row in a directory, and rebuilding them from a handful of changed rows
 * would replace good listings with truncated ones. Leaving them alone means a
 * renamed document keeps its old label in its directory's listing until a full
 * read -- stale, rather than wrong.
 *
 * And it does not report deletions. A query for what changed cannot return a
 * row that is no longer there, and a row that stopped matching `where` -- a
 * metric that was unpublished -- looks the same as one that was never touched.
 *
 * So this is an optimisation for the common case, edits to documents that go on
 * existing. Pair it with a periodic full read to reconcile the rest.
 */
export async function loadChangedBundle(
  config: DbConfig | unknown,
  query: QueryFn,
  since: SourceCursor,
  options: { placeholder?: Placeholder } = {},
): Promise<ChangedBundle> {
  const parsed = parseDbConfig(config);
  if (!tracksChanges(parsed)) {
    throw new TypeError(
      'loadChangedBundle needs every mapping to declare `changedColumn`; otherwise a read would silently miss whole tables.',
    );
  }

  let cursor = since;
  const results = await Promise.all(
    parsed.tables.map(async (mapping) => {
      const statement = buildChangedStatement(mapping, options.placeholder);
      const rows = toRows(await query(statement, [since]), statement);
      cursor = advance(cursor, rows, mapping.changedColumn!);
      return rows;
    }),
  );

  // Indexes are built from every row, so they are left to a full read.
  const { files, diagnostics } = rowsToFiles({ ...parsed, generateIndexes: false }, results);
  return { files, diagnostics, cursor };
}
