import { describe, expect, it, vi } from 'vitest';
import { parseBundle } from '../src/index.js';
import {
  buildChangedStatement,
  buildStatement,
  databaseSource,
  loadBundle,
  loadChangedBundle,
  parseDbConfig,
  rowsToFiles,
  tracksChanges,
  type DbConfig,
  type Row,
} from '../src/db/index.js';

/* ------------------------------------------------------------- the fixture */

const config: DbConfig = {
  okfVersion: '0.2',
  title: 'Acme analytics',
  tables: [
    {
      table: 'analytics.metric_definitions',
      path: 'metrics/{metric_name}.md',
      type: 'Metric',
      title: 'display_name',
      body: 'definition_md',
      frontmatter: {
        description: 'summary',
        tags: 'tags',
        status: 'lifecycle',
        stale_after: 'review_by',
      },
      constants: { generated: { by: 'process:warehouse-sync' } },
      directory: { title: 'Metrics', description: 'Agreed definitions for the numbers.' },
      where: 'is_published',
      orderBy: 'metric_name',
    },
    {
      table: 'analytics.warehouse_tables',
      path: 'tables/{table_name}.md',
      type: 'Table',
      title: 'table_name',
      template: '# {table_name}\n\n{notes}\n\nGrain: {grain}.',
      frontmatter: { resource: 'fqn', description: 'notes' },
      directory: { description: 'Warehouse tables behind the metrics.' },
    },
  ],
};

const metricRows: Row[] = [
  {
    metric_name: 'gross_revenue',
    display_name: 'Gross revenue',
    summary: 'Total charged before refunds.',
    definition_md: 'Sums `gross_amount` over confirmed orders in [orders](../tables/orders.md).',
    tags: ['revenue', 'finance'],
    lifecycle: 'stable',
    review_by: new Date('2027-01-01T00:00:00Z'),
    is_published: true,
  },
  {
    metric_name: 'Repeat Purchase Rate',
    display_name: 'Repeat purchase rate',
    summary: 'Share of customers with more than one order.',
    definition_md: 'Customers with `order_count > 1`, over all customers.',
    tags: [],
    lifecycle: null,
    review_by: null,
    is_published: true,
  },
];

const tableRows: Row[] = [
  {
    table_name: 'orders',
    fqn: 'bigquery://acme.warehouse.orders',
    notes: 'One row per confirmed order.',
    grain: 'order',
  },
];

const results = [metricRows, tableRows];

/* -------------------------------------------------------------- the config */

describe('parseDbConfig', () => {
  it('accepts a complete config', () => {
    expect(parseDbConfig(config).tables).toHaveLength(2);
  });

  it('rejects wiring mistakes loudly, rather than rendering half a bundle', () => {
    expect(() => parseDbConfig({ tables: [] })).toThrow(/at least one table/);
    expect(() => parseDbConfig({ tables: [{ path: 'a/{b}.md' }] })).toThrow(/`table` or `sql`/);
    expect(() => parseDbConfig({ tables: [{ table: 't' }] })).toThrow(/`path` template/);
    expect(() => parseDbConfig({ tables: [{ table: 't', path: 'metrics.md' }] })).toThrow(
      /no \{column\} placeholder/,
    );
    expect(() =>
      parseDbConfig({ tables: [{ table: 'a join b', path: '{x}.md' }] }),
    ).toThrow(/not a plain table name/);
    expect(() =>
      parseDbConfig({ tables: [{ table: 't', path: '{x}.md', limit: 0 }] }),
    ).toThrow(/positive integer/);
    expect(() => parseDbConfig({ tables: [{ table: 't', path: '{x}.md', frontmatter: { a: 1 } }] })).toThrow(
      /must be a column name/,
    );
    expect(() => parseDbConfig({ tables: [{ table: 't', path: '{x}.md', json: 'tags' }] })).toThrow(
      /must be an array of column names/,
    );
  });

  it('lets a join through as raw sql', () => {
    const parsed = parseDbConfig({
      tables: [{ sql: 'select * from a join b using (id)', path: '{id}.md' }],
    });
    expect(parsed.tables[0]!.sql).toContain('join');
  });
});

describe('buildStatement', () => {
  it('assembles the clauses a mapping declares', () => {
    expect(buildStatement(config.tables[0]!)).toBe(
      'select * from analytics.metric_definitions where is_published order by metric_name',
    );
    expect(buildStatement(config.tables[1]!)).toBe('select * from analytics.warehouse_tables');
    expect(buildStatement({ table: 't', path: '{x}.md', limit: 10 })).toBe(
      'select * from t limit 10',
    );
  });

  it('uses raw sql verbatim when given', () => {
    expect(buildStatement({ sql: 'select 1', table: 'ignored', path: '{x}.md' })).toBe('select 1');
  });
});

/* ------------------------------------------------------------- the mapping */

describe('rowsToFiles', () => {
  const { files, diagnostics } = rowsToFiles(config, results);

  it('writes a file per row at the templated path', () => {
    expect(Object.keys(files).sort()).toEqual([
      'index.md',
      'metrics/gross_revenue.md',
      'metrics/index.md',
      'metrics/repeat-purchase-rate.md',
      'tables/index.md',
      'tables/orders.md',
    ]);
  });

  it('turns columns into frontmatter, with database types made YAML', () => {
    const doc = files['metrics/gross_revenue.md']!;
    expect(doc).toMatch(/^---\n/);
    expect(doc).toContain('type: Metric');
    expect(doc).toContain('title: Gross revenue');
    expect(doc).toContain('description: Total charged before refunds.');
    expect(doc).toContain('stale_after: 2027-01-01T00:00:00.000Z');
    expect(doc).toContain('by: process:warehouse-sync');
    expect(doc).toContain('Sums `gross_amount`');
  });

  it('omits null columns rather than writing empty keys', () => {
    const doc = files['metrics/repeat-purchase-rate.md']!;
    expect(doc).not.toContain('stale_after');
    expect(doc).not.toContain('status:');
  });

  it('slugs a row value into one path segment, keeping identifiers intact', () => {
    // `gross_revenue` is already a legal segment and survives verbatim, so a
    // bundle keeps the warehouse's own names; prose gets the usual hyphens.
    expect(files['metrics/gross_revenue.md']).toBeDefined();
    expect(files['metrics/repeat-purchase-rate.md']).toBeDefined();
  });

  it('composes a body from a template when the table holds facts, not prose', () => {
    expect(files['tables/orders.md']).toContain('# orders\n\nOne row per confirmed order.\n\nGrain: order.');
  });

  it('reports nothing wrong with a clean mapping', () => {
    expect(diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
  });
});

describe('generated indexes', () => {
  const { files } = rowsToFiles(config, results);

  it('gives the root an index listing the directories', () => {
    expect(files['index.md']).toBe(
      '---\nokf_version: "0.2"\n---\n\n# Acme analytics\n\n' +
        '* [Metrics](metrics/index.md) - Agreed definitions for the numbers.\n' +
        '* [tables](tables/index.md) - Warehouse tables behind the metrics.\n',
    );
  });

  it('lists each directory’s documents with their descriptions, in row order', () => {
    expect(files['metrics/index.md']).toBe(
      '# Metrics\n\n' +
        '* [Gross revenue](gross_revenue.md) - Total charged before refunds.\n' +
        '* [Repeat purchase rate](repeat-purchase-rate.md) - Share of customers with more than one order.\n',
    );
  });

  it('can be switched off', () => {
    const { files: bare } = rowsToFiles({ ...config, generateIndexes: false }, results);
    expect(Object.keys(bare).some((path) => path.endsWith('index.md'))).toBe(false);
  });

  it('never overwrites an index a mapping wrote itself', () => {
    const { files: own } = rowsToFiles(
      { tables: [{ table: 't', path: '{dir}/index.md', body: 'md' }] },
      [[{ dir: 'metrics', md: '# Hand-written' }]],
    );
    expect(own['metrics/index.md']).toContain('# Hand-written');
  });
});

/* --------------------------------------------------------- what can go wrong */

describe('data problems become diagnostics, not exceptions', () => {
  it('skips a row whose path column the query did not return', () => {
    const { files, diagnostics } = rowsToFiles(config, [
      [{ display_name: 'Nameless', definition_md: 'body' }],
      [],
    ]);
    expect(Object.keys(files).filter((p) => p.startsWith('metrics/'))).toEqual([]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing-column', severity: 'warning' }),
    );
  });

  it('skips a row whose path column came back null', () => {
    const { files, diagnostics } = rowsToFiles(config, [
      [{ metric_name: null, display_name: 'Nameless', definition_md: 'body' }],
      [],
    ]);
    expect(Object.keys(files)).not.toContain('metrics/.md');
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'empty-path-segment', severity: 'warning' }),
    );
  });

  it('keeps the first of two rows that map to the same path', () => {
    const { files, diagnostics } = rowsToFiles(config, [
      [
        { metric_name: 'revenue', display_name: 'First', definition_md: 'first' },
        { metric_name: 'Revenue', display_name: 'Second', definition_md: 'second' },
      ],
      [],
    ]);
    expect(files['metrics/revenue.md']).toContain('first');
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'path-collision', filePath: 'metrics/revenue.md' }),
    );
  });

  it('keeps a malformed JSON column as text rather than dropping it', () => {
    const { files, diagnostics } = rowsToFiles(
      {
        tables: [
          {
            table: 'm',
            path: '{name}.md',
            body: 'md',
            frontmatter: { tags: 'tags' },
            json: ['tags'],
          },
        ],
      },
      [[{ name: 'broken', md: 'body', tags: '["unterminated' }]],
    );
    expect(files['broken.md']).toContain('unterminated');
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-json', severity: 'warning' }),
    );
  });

  it('parses a JSON column into a real list, for engines with no array type', () => {
    const { files } = rowsToFiles(
      {
        tables: [
          {
            table: 'm',
            path: '{name}.md',
            body: 'md',
            frontmatter: { tags: 'tags' },
            json: ['tags'],
          },
        ],
      },
      [[{ name: 'ok', md: 'body', tags: '["revenue","finance"]' }]],
    );
    expect(files['ok.md']).toContain('tags:\n  - revenue\n  - finance');
  });

  it('notes a table that returned nothing', () => {
    const { diagnostics } = rowsToFiles(config, [[], []]);
    expect(diagnostics.filter((d) => d.code === 'empty-result')).toHaveLength(2);
  });

  it('notes a document that came back with no body', () => {
    const { diagnostics } = rowsToFiles(config, [
      [{ metric_name: 'empty', display_name: 'Empty', definition_md: '' }],
      [],
    ]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'empty-body', filePath: 'metrics/empty.md' }),
    );
  });
});

/* ------------------------------------------------------------ the round trip */

describe('a database-backed bundle', () => {
  it('parses as a bundle like any other, with routing, links, and nav', () => {
    const { files } = rowsToFiles(config, results);
    const bundle = parseBundle(files);

    expect(bundle.okfVersion).toBe('0.2');
    expect([...bundle.byRoute.keys()].sort()).toEqual([
      '/',
      '/metrics',
      '/metrics/gross_revenue',
      '/metrics/repeat-purchase-rate',
      '/tables',
      '/tables/orders',
    ]);

    const metric = bundle.byRoute.get('/metrics/gross_revenue')!;
    expect(metric.kind).toBe('concept');
    expect(metric.title).toBe('Gross revenue');
    expect(metric.frontmatter.type).toBe('Metric');
    expect(metric.frontmatter.tags).toEqual(['revenue', 'finance']);
    expect(metric.frontmatter.generated?.by?.raw).toBe('process:warehouse-sync');
    expect(metric.frontmatter.staleAfter).toBe('2027-01-01T00:00:00.000Z');

    // The body link resolved against the generated tree, so cross-table
    // references survive the trip through the database.
    expect(metric.links).toContainEqual({ route: '/tables/orders', broken: false });
    expect(bundle.backlinks.get('/tables/orders')).toContainEqual(
      expect.objectContaining({ route: '/metrics/gross_revenue', type: 'Metric' }),
    );

    expect(bundle.tree.map((node) => node.route)).toEqual(['/metrics', '/tables']);
    expect(bundle.diagnostics).toEqual([]);
  });
});

/* --------------------------------------------------------------- the loader */

describe('loadBundle', () => {
  it('runs each mapping’s statement and maps the rows it gets back', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes('metric_definitions') ? metricRows : tableRows,
    );

    const { files, diagnostics } = await loadBundle(config, query);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(
      'select * from analytics.metric_definitions where is_published order by metric_name',
      [],
    );
    expect(files['metrics/gross_revenue.md']).toContain('title: Gross revenue');
    expect(diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
  });

  it('takes a driver result object as readily as an array of rows', async () => {
    const { files } = await loadBundle(config, async (sql: string) => ({
      rows: sql.includes('metric_definitions') ? metricRows : tableRows,
    }));
    expect(files['tables/orders.md']).toContain('# orders');
  });

  it('validates the config before it touches the database', async () => {
    const query = vi.fn();
    await expect(loadBundle({ tables: [] }, query)).rejects.toThrow(/at least one table/);
    expect(query).not.toHaveBeenCalled();
  });

  it('says so when the query function returns something unusable', async () => {
    await expect(loadBundle(config, () => 'nope' as never)).rejects.toThrow(
      /neither an array of rows nor a \{ rows \} result/,
    );
  });
});


/* ------------------------------------------------------ reading what changed */

const tracked: DbConfig = {
  okfVersion: '0.2',
  title: 'Acme analytics',
  tables: [
    {
      table: 'analytics.metric_definitions',
      path: 'metrics/{metric_name}.md',
      type: 'Metric',
      title: 'display_name',
      body: 'definition_md',
      frontmatter: { description: 'summary' },
      changedColumn: 'updated_at',
      where: 'is_published',
      directory: { title: 'Metrics' },
    },
  ],
};

describe('change tracking', () => {
  it('recognises a config that can say what changed', () => {
    expect(tracksChanges(tracked)).toBe(true);
    expect(tracksChanges(config)).toBe(false);
  });

  it('asks for rows past the cursor, keeping the mapping\u2019s own filter', () => {
    expect(buildChangedStatement(tracked.tables[0]!)).toBe(
      'select * from analytics.metric_definitions where (is_published) and updated_at > ?',
    );
  });

  it('writes the placeholder the engine expects', () => {
    expect(buildChangedStatement(tracked.tables[0]!, (i) => `$${i}`)).toBe(
      'select * from analytics.metric_definitions where (is_published) and updated_at > $1',
    );
  });

  it('refuses to bolt a predicate onto a statement it did not build', () => {
    expect(() =>
      parseDbConfig({
        tables: [{ sql: 'select * from a join b', path: '{id}.md', changedColumn: 'updated_at' }],
      }),
    ).toThrow(/cannot combine/);
  });

  it('rejects a change column that is not a plain column name', () => {
    expect(() =>
      parseDbConfig({
        tables: [{ table: 't', path: '{x}.md', changedColumn: 'updated_at; drop table t' }],
      }),
    ).toThrow(/plain column name/);
  });

  it('reads the rows past the cursor and moves it forward', async () => {
    const query = vi.fn(async () => [
      {
        metric_name: 'gross_revenue',
        display_name: 'Gross revenue',
        summary: 'Total charged.',
        definition_md: 'Sums it up.',
        updated_at: '2026-09-15T10:00:00Z',
      },
      {
        metric_name: 'net_revenue',
        display_name: 'Net revenue',
        summary: 'After refunds.',
        definition_md: 'Less refunds.',
        updated_at: '2026-09-15T11:30:00Z',
      },
    ]);

    const changed = await loadChangedBundle(tracked, query, '2026-09-15T09:00:00Z');

    expect(query).toHaveBeenCalledWith(expect.stringContaining('updated_at > ?'), [
      '2026-09-15T09:00:00Z',
    ]);
    expect(Object.keys(changed.files).sort()).toEqual([
      'metrics/gross_revenue.md',
      'metrics/net_revenue.md',
    ]);
    // The furthest-forward value seen, not the time of the read.
    expect(changed.cursor).toBe('2026-09-15T11:30:00Z');
  });

  it('leaves the synthesized indexes alone', async () => {
    const query = vi.fn(async () => [
      {
        metric_name: 'gross_revenue',
        display_name: 'Gross revenue',
        summary: 'Total charged.',
        definition_md: 'Sums it up.',
        updated_at: '2026-09-15T10:00:00Z',
      },
    ]);

    const changed = await loadChangedBundle(tracked, query, '');

    // Rebuilding `metrics/index.md` from one changed row would replace a good
    // listing with a listing of one.
    expect(Object.keys(changed.files)).toEqual(['metrics/gross_revenue.md']);
  });

  it('holds the cursor where it was when nothing changed', async () => {
    const changed = await loadChangedBundle(tracked, async () => [], '2026-09-15T09:00:00Z');
    expect(changed.files).toEqual({});
    expect(changed.cursor).toBe('2026-09-15T09:00:00Z');
  });

  it('refuses when a mapping cannot say what changed', async () => {
    await expect(loadChangedBundle(config, async () => [], '')).rejects.toThrow(
      /every mapping to declare/,
    );
  });
});

describe('databaseSource', () => {
  it('offers loadChanged only when the config supports it', () => {
    expect(databaseSource(tracked, async () => []).loadChanged).toBeInstanceOf(Function);
    expect(databaseSource(config, async () => []).loadChanged).toBeUndefined();
  });

  it('starts the cursor before every row, so the first ask misses nothing', async () => {
    const source = databaseSource(tracked, async () => []);
    const { cursor } = await source.load();
    expect(cursor).toBe('');
  });

  it('reports no deletions, because a query for changes cannot see them', async () => {
    const source = databaseSource(tracked, async () => []);
    const changes = await source.loadChanged!('');
    expect(changes.deleted).toEqual([]);
  });
});
