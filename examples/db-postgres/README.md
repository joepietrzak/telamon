# telamon on Postgres

Road 3 of [three roads](../../packages/telamon/docs/three-roads.md), against a
real engine. The point of this example is how little of it is about Postgres.

## The seam

telamon never opens a connection. It hands you SQL and takes rows back:

```js
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/** SQL in, rows out. Swapping Postgres for anything else swaps this. */
const query = async (sql, params) => (await pool.query(sql, params)).rows;

const source = databaseSource(config, query, {
  placeholder: (index) => `$${index}`,
});
```

That is the whole driver integration. No adapter to install, no dialect to
configure, and nothing in telamon that imports `pg` — so a driver it has never
heard of works exactly as well, and your connection pooling, TLS, IAM auth,
read replicas and query timeouts stay yours.

## Run it

```bash
docker compose up
# → http://localhost:3000
```

Or point it at a database you already have:

```bash
DATABASE_URL=postgres://user:pass@host:5432/db npm start
```

`schema.sql` creates a small metrics warehouse, and `okf.db.json` maps it to a
bundle. Edit a row and the site follows within a tick:

```bash
docker compose exec db psql -U telamon -d telamon \
  -c "update analytics.metric_definitions
         set display_name = 'Net revenue (restated)', updated_at = now()
       where metric_name = 'net_revenue';"
```

```
refresh: reparsed 1 document(s)
```

No restart, no rebuild, and one document re-parsed rather than nine.

## What is actually Postgres-specific

Four things. Everything else in `server.mjs` is the same server as
[`examples/deploy`](../deploy), which does not know what it is reading from.

### 1. Placeholders

Postgres binds `$1`; SQLite and MySQL bind `?`. telamon has no way to know
which engine it is talking to, so `placeholder` tells it.

Get this wrong and a full read still works — it binds nothing — while the first
*incremental* read fails with a syntax error. Which is to say: it works in
development and fails in production, unless you exercise a refresh. This
example's `compose.yml` refreshes every five seconds partly so that path is
never untested.

### 2. Types arrive as themselves

`pg` parses Postgres types into JavaScript ones, so the mapping does less work
than it does on SQLite:

| column | comes back as | in the mapping |
| --- | --- | --- |
| `text[]` | a real array | nothing — it is already a list |
| `jsonb` | a real object | nothing |
| `timestamptz` | a `Date` | nothing — normalized to ISO-8601 |
| `boolean` | a real boolean | usable directly in `where` |

The `json: [...]` option exists for engines that hand back JSON as *text* —
SQLite, MySQL, BigQuery. On Postgres, listing a `jsonb` column there would try
to parse an object that is already an object. This example lists nothing.

### 3. Schema-qualified names

`"table": "analytics.okf_metrics"` is a plain table name as far as the config
validator is concerned, dot included. Anything more complicated than a name
belongs in `sql`, or in a view.

### 4. Views do what a mapping cannot

A mapping reads one relation. Two things here need more than that, and both are
a view's job rather than a renderer's:

**The join.** `relationships` comes from `metric_inputs`, aggregated with
`jsonb_agg`. Targets name the file the mapping will write, using the natural
key — telamon slugifies a relationship target the same way it slugifies a path,
so the view does not have to guess the rule.

**The change stamp.** A view's `updated_at` has to move when anything it reads
moves, or an incremental read misses an edit to the join. Here that is
`greatest(m.updated_at, max(t.updated_at))`, and touching a table shows up as a
change to every metric that reads it.

## One sharp edge worth copying

Both views wrap their timestamp in `date_trunc('milliseconds', ...)`.

`timestamptz` keeps microseconds. A JavaScript `Date` does not. So a watermark
read back through a driver that returns Dates is the *truncated* value, and
`updated_at > '2026-09-16T18:19:05.044Z'` is still true of a row stamped
`18:19:05.044901`. Without the truncation every tick re-reads whichever rows sit
on the boundary — forever.

It is not incorrect: telamon re-parses only documents whose text actually
differs, so those rows cost a query and nothing else. But it is a query per tick
for nothing, and a log line that says three documents changed when none did.
Truncating to the precision the cursor can hold costs one function call:

```
before:  nothing changed -> 3 changed files
after:   nothing changed -> 0 changed files
```

The same applies to any engine whose timestamps are finer than a millisecond.
If your change column is a sequence or a version integer instead, none of this
arises.

## Bring your own driver

| engine | `query` | `placeholder` |
| --- | --- | --- |
| Postgres (`pg`) | `async (sql, p) => (await pool.query(sql, p)).rows` | `(i) => \`$${i}\`` |
| Postgres (`postgres.js`) | `(sql, p) => client.unsafe(sql, p)` | `(i) => \`$${i}\`` |
| SQLite (`node:sqlite`) | `(sql, p) => db.prepare(sql).all(...p)` | default `?` |
| MySQL (`mysql2`) | `async (sql, p) => (await pool.query(sql, p))[0]` | default `?` |
| BigQuery | `async (sql, p) => (await bq.query({ query: sql, params: p }))[0]` | `(i) => \`@p${i}\`` |
| SQL Server (`mssql`) | `async (sql, p) => (await pool.request().query(sql)).recordset` | `(i) => \`@p${i}\`` |

Rows only have to be plain objects keyed by column name. Whatever gets you
there is a valid driver.

## Files

| | |
| --- | --- |
| `schema.sql` | the warehouse, and the two views the mapping reads |
| `okf.db.json` | the mapping: tables to paths, columns to frontmatter |
| `server.mjs` | the pool, the `query` seam, and the refresh loop |
| `compose.yml` | Postgres plus the site |
