/**
 * The mapping config: which tables in a source database become which files.
 *
 * A bundle is a filesystem, so connecting a database to one is entirely a
 * question of naming -- which rows become which paths, and which columns become
 * frontmatter. That question is data, not code, which is why it lives in a JSON
 * file you can keep beside the bundle and diff.
 */

/** A row as a driver hands it back. Values stay whatever the driver produced. */
export type Row = Record<string, unknown>;

export interface DirectoryInfo {
  /** Heading for the generated `index.md`. Defaults to the directory name, humanized. */
  title?: string;
  /** Sentence describing the directory in its parent's index listing. */
  description?: string;
}

export interface TableMapping {
  /**
   * Source table, optionally schema-qualified: `analytics.metric_definitions`.
   * Ignored when `sql` is present.
   */
  table?: string;
  /** Full statement, for anything a table plus `where` cannot express. */
  sql?: string;
  /**
   * Destination path, with `{column}` placeholders filled from each row and
   * slugified: `metrics/{metric_name}.md`. A missing `.md` is appended.
   */
  path: string;
  /** Literal OKF `type` for every document this mapping produces (SPEC §5). */
  type?: string;
  /** Column holding the document title. */
  title?: string;
  /** Column holding the markdown body. */
  body?: string;
  /**
   * Markdown body composed from columns, `{column}` interpolated verbatim.
   * Takes precedence over `body`, for tables that hold facts rather than prose.
   */
  template?: string;
  /** Frontmatter key -> column name. */
  frontmatter?: Record<string, string>;
  /**
   * Columns holding JSON text, parsed before they become frontmatter.
   *
   * Postgres hands back a real array for `tags`; SQLite, MySQL, and BigQuery
   * hand back a string, and frontmatter that says `tags: '["a","b"]'` is a
   * string rather than the list SPEC §5 asks for.
   */
  json?: string[];
  /** Frontmatter key -> fixed value, merged over the column-derived keys. */
  constants?: Record<string, unknown>;
  /** Describes the directory this mapping fills, for the generated indexes. */
  directory?: DirectoryInfo;
  /**
   * Column holding a value that only ever moves forward when a row changes --
   * an `updated_at`, a version, a sequence. Declaring it lets the source ask
   * for what changed rather than re-reading the table.
   */
  changedColumn?: string;
  /** Appended to the generated statement as `where <...>`. */
  where?: string;
  /** Appended as `order by <...>`. */
  orderBy?: string;
  limit?: number;
}

export interface DbConfig {
  /** Written as `okf_version` on the bundle root (SPEC §12). */
  okfVersion?: string;
  /** Heading of the root `index.md`, and so the site title. */
  title?: string;
  /**
   * Synthesize an `index.md` for the root and every mapped directory that a
   * mapping did not write itself (SPEC §8). On by default: without indexes a
   * bundle has no authored navigation, only a directory listing.
   */
  generateIndexes?: boolean;
  tables: TableMapping[];
}

/**
 * A table name we are willing to interpolate into a statement: dotted plain
 * identifiers only. Anything more exotic -- quoting, a join, a CTE -- belongs
 * in `sql`, where the author is plainly writing SQL rather than naming a table.
 */
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*)*$/;

function fail(message: string): never {
  throw new TypeError(`Invalid telamon database config: ${message}`);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${where} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asStringMap(value: unknown, where: string): Record<string, string> {
  const record = asRecord(value, where);
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== 'string') fail(`${where}.${key} must be a column name.`);
  }
  return record as Record<string, string>;
}

/**
 * A column we are willing to interpolate into a statement.
 *
 * Unlike the values in `frontmatter`, which are only ever looked up on a row
 * this has already been handed, `changedColumn` is written into SQL -- so it
 * has to look like a column and nothing else.
 */
function asColumnName(value: unknown, where: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) {
    fail(`${where} must be a plain column name.`);
  }
  return value;
}

function asStringList(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    fail(`${where} must be an array of column names.`);
  }
  return value as string[];
}

function optionalString(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(`${where} must be a string.`);
  return value;
}

/**
 * Validate a parsed JSON config.
 *
 * Unlike bundle content -- where a problem is the author's and becomes a
 * diagnostic -- a malformed config is a mistake in the wiring, and failing
 * loudly at startup beats rendering a bundle that is quietly missing a table.
 */
export function parseDbConfig(input: unknown): DbConfig {
  const raw = asRecord(input, 'the config');

  if (!Array.isArray(raw.tables)) fail('`tables` must be an array of mappings.');
  if (raw.tables.length === 0) fail('`tables` must name at least one table.');

  const tables = raw.tables.map((entry, index): TableMapping => {
    const where = `tables[${index}]`;
    const mapping = asRecord(entry, where);

    const table = optionalString(mapping.table, `${where}.table`);
    const sql = optionalString(mapping.sql, `${where}.sql`);
    if (!table && !sql) fail(`${where} needs either \`table\` or \`sql\`.`);
    if (table && !sql && !TABLE_NAME.test(table)) {
      fail(`${where}.table "${table}" is not a plain table name; use \`sql\` instead.`);
    }

    if (mapping.changedColumn !== undefined && sql !== undefined) {
      fail(
        `${where} cannot combine \`changedColumn\` with \`sql\`: there is no safe way to add a ` +
          'predicate to a statement telamon did not build.',
      );
    }

    const path = optionalString(mapping.path, `${where}.path`);
    if (!path) fail(`${where} needs a \`path\` template.`);
    if (!/\{[^}]+\}/.test(path)) {
      fail(`${where}.path "${path}" has no {column} placeholder, so every row would collide.`);
    }

    if (mapping.limit !== undefined && (typeof mapping.limit !== 'number' || !Number.isInteger(mapping.limit) || mapping.limit <= 0)) {
      fail(`${where}.limit must be a positive integer.`);
    }

    return {
      ...(table !== undefined && { table }),
      ...(sql !== undefined && { sql }),
      path,
      ...(mapping.type !== undefined && { type: optionalString(mapping.type, `${where}.type`)! }),
      ...(mapping.title !== undefined && { title: optionalString(mapping.title, `${where}.title`)! }),
      ...(mapping.body !== undefined && { body: optionalString(mapping.body, `${where}.body`)! }),
      ...(mapping.template !== undefined && {
        template: optionalString(mapping.template, `${where}.template`)!,
      }),
      ...(mapping.frontmatter !== undefined && {
        frontmatter: asStringMap(mapping.frontmatter, `${where}.frontmatter`),
      }),
      ...(mapping.json !== undefined && { json: asStringList(mapping.json, `${where}.json`) }),
      ...(mapping.constants !== undefined && {
        constants: asRecord(mapping.constants, `${where}.constants`),
      }),
      ...(mapping.directory !== undefined && {
        directory: asRecord(mapping.directory, `${where}.directory`) as DirectoryInfo,
      }),
      ...(mapping.changedColumn !== undefined && {
        changedColumn: asColumnName(mapping.changedColumn, `${where}.changedColumn`),
      }),
      ...(mapping.where !== undefined && { where: optionalString(mapping.where, `${where}.where`)! }),
      ...(mapping.orderBy !== undefined && {
        orderBy: optionalString(mapping.orderBy, `${where}.orderBy`)!,
      }),
      ...(mapping.limit !== undefined && { limit: mapping.limit as number }),
    };
  });

  if (raw.generateIndexes !== undefined && typeof raw.generateIndexes !== 'boolean') {
    fail('`generateIndexes` must be a boolean.');
  }

  return {
    ...(raw.okfVersion !== undefined && {
      okfVersion: optionalString(raw.okfVersion, 'okfVersion')!,
    }),
    ...(raw.title !== undefined && { title: optionalString(raw.title, 'title')! }),
    ...(raw.generateIndexes !== undefined && { generateIndexes: raw.generateIndexes }),
    tables,
  };
}
