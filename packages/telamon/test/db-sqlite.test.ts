/**
 * The same mapping the other database tests use, but driven by a real engine.
 *
 * Everywhere else the query function is a fake returning literals, which proves
 * the mapping and nothing about the seam. SQLite is the sharpest cheap check of
 * that seam: it has no array type, no boolean, and hands back plain objects, so
 * a mapping that only ever worked against hand-written rows fails here.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parseBundle } from '../src/index.js';
import { loadBundle, type DbConfig } from '../src/db/index.js';

/** Only the sliver of `node:sqlite` this test drives, so it needs no typings. */
interface SqliteModule {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { all(...params: unknown[]): Record<string, unknown>[] };
    close(): void;
  };
}

let sqlite: SqliteModule | undefined;
let unavailable = '';
try {
  // `require`, not a dynamic import: Vite does not carry `node:sqlite` in its
  // builtin list and tries to resolve it as a package, so an import here skips
  // the whole file on a Node that supports it perfectly well.
  sqlite = createRequire(import.meta.url)('node:sqlite') as SqliteModule;
} catch (error) {
  unavailable = error instanceof Error ? error.message : String(error);
}

// A silent skip reads as coverage that does not exist, so say why out loud.
if (!sqlite) {
  console.warn(`Skipping the real-driver SQLite tests -- node:sqlite is unavailable: ${unavailable}`);
}

const describeSqlite = sqlite ? describe : describe.skip;

const SCHEMA = `
  create table metric_definitions (
    metric_name   text primary key,
    display_name  text not null,
    summary       text,
    definition_md text not null,
    tags          text,
    lifecycle     text,
    review_by     text,
    is_published  integer not null default 1
  );

  create table warehouse_tables (
    table_name text primary key,
    fqn        text not null,
    notes      text
  );

  insert into metric_definitions values
    ('gross_revenue', 'Gross revenue', 'Total charged before refunds.',
     'Sums gross_amount over [orders](../tables/orders.md).',
     '["revenue","finance"]', 'stable', '2027-01-01T00:00:00Z', 1),
    ('draft_metric', 'Draft metric', 'Not for publication.',
     'Should not reach the bundle.', '[]', 'draft', null, 0);

  insert into warehouse_tables values
    ('orders', 'bigquery://acme.warehouse.orders', 'One row per order.');
`;

const config: DbConfig = {
  okfVersion: '0.2',
  title: 'Acme storefront analytics',
  tables: [
    {
      table: 'warehouse_tables',
      path: 'tables/{table_name}.md',
      type: 'Table',
      title: 'table_name',
      template: '{notes}',
      frontmatter: { description: 'notes', resource: 'fqn' },
      directory: { title: 'Tables', description: 'Warehouse tables.' },
      orderBy: 'table_name',
    },
    {
      table: 'metric_definitions',
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
      json: ['tags'],
      directory: { title: 'Metrics', description: 'Agreed definitions.' },
      where: 'is_published = 1',
      orderBy: 'metric_name',
    },
  ],
};

describeSqlite('against a real SQLite database', () => {
  function open() {
    const db = new sqlite!.DatabaseSync(':memory:');
    db.exec(SCHEMA);
    return db;
  }

  it('reads a bundle straight out of the database', async () => {
    const db = open();
    const { files, diagnostics } = await loadBundle(config, (sql, params) =>
      db.prepare(sql).all(...params),
    );
    db.close();

    expect(Object.keys(files).sort()).toEqual([
      'index.md',
      'metrics/gross_revenue.md',
      'metrics/index.md',
      'tables/index.md',
      'tables/orders.md',
    ]);
    expect(diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
  });

  it('honours the mapping’s where clause as the publication gate', async () => {
    const db = open();
    const { files } = await loadBundle(config, (sql, params) =>
      db.prepare(sql).all(...params),
    );
    db.close();

    // The row is in the table; `is_published = 0` keeps it out of the bundle.
    expect(files['metrics/draft_metric.md']).toBeUndefined();
  });

  it('parses into a bundle whose frontmatter survived the engine’s types', async () => {
    const db = open();
    const { files } = await loadBundle(config, (sql, params) =>
      db.prepare(sql).all(...params),
    );
    db.close();

    const bundle = parseBundle(files);
    expect(bundle.diagnostics).toEqual([]);
    expect(bundle.okfVersion).toBe('0.2');

    const metric = bundle.byRoute.get('/metrics/gross_revenue')!;
    expect(metric.title).toBe('Gross revenue');
    expect(metric.frontmatter.type).toBe('Metric');
    // SQLite has no array type: without `json: ['tags']` this is the string
    // '["revenue","finance"]' and the tag chrome renders one long tag.
    expect(metric.frontmatter.tags).toEqual(['revenue', 'finance']);
    expect(metric.frontmatter.status).toBe('stable');
    expect(metric.frontmatter.staleAfter).toBe('2027-01-01T00:00:00Z');

    const table = bundle.byRoute.get('/tables/orders')!;
    expect(table.frontmatter.resource).toBe('bigquery://acme.warehouse.orders');

    // The relative link in the SQL body resolved against the generated tree.
    expect(metric.links).toContainEqual({ route: '/tables/orders', broken: false });
    expect(bundle.tree.map((n) => n.route)).toEqual(['/metrics', '/tables']);
  });
});
