import { parseDbConfig, type DbConfig, type Row, type TableMapping } from './config.js';
import { rowsToFiles, type MappedBundle } from './mapping.js';

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
