# db-sync

A SQLite warehouse, a JSON mapping, and a thirty-line script that turns one into an OKF bundle.

```bash
pnpm --filter db-sync sync
```

Needs Node 22.5 or newer for the built-in `node:sqlite`, which prints an experimental-feature warning on startup. Nothing else is installed: the point of `telamon/db` is that it has no driver of its own.

## What's here

| | |
| --- | --- |
| `warehouse.sql` | Schema and seed rows — metric definitions, warehouse tables, a pipeline. Deliberately written as a data team would keep it, with no thought given to telamon. |
| `okf.db.json` | The mapping: which tables become which paths, which columns become frontmatter. |
| `sync.mjs` | Opens the database, calls `loadBundle`, writes `bundle/`. |

## The database-specific part

```js
const query = (sql, params) => db.prepare(sql).all(...params);
```

That is the whole of it. telamon hands that function SQL and takes rows back, so pointing this at Postgres means replacing one line, not rewriting the script — and the credentials, the pool, and the dialect never enter the library.

## What the mapping buys over a dump

Six metrics are in the table and five reach the bundle:

- **`where: "is_published = 1"`** makes the mapping a publication gate. `internal_scratch_metric` stays in the warehouse where it belongs.
- **`json: ["tags"]`** parses `'["revenue","finance"]'` into a real list. SQLite has no array type, and without this the tag chrome renders one long tag reading `["revenue","finance"]`.
- **`template` instead of `body`** composes markdown for `warehouse_tables`, which holds facts rather than prose — a sentence built from `notes`, `grain`, and `row_estimate`.
- **Generated indexes** give each directory an `index.md` carrying order and one-line descriptions, so the sidebar reads like an authored bundle rather than a directory listing.
- **Relative links survive.** `definition_md` contains `[orders](../tables/orders.md)`, which resolves against the generated tree — so a link written in SQL becomes a backlink and a graph edge.

## Seeing it rendered

`bundle/` is an ordinary OKF bundle. Point the playground at it, or read it in a test:

```ts
import { parseBundle } from 'telamon';

const bundle = parseBundle(files);
bundle.byRoute.get('/metrics/gross_revenue');
```

Run it per request from a server loader for always-fresh pages, or at build time like this and commit the result.
