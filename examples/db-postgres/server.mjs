// telamon against Postgres.
//
// The database-specific part of this file is twelve lines: a pool, a `query`
// function, and a placeholder style. Everything below that is the same server
// as examples/deploy, which does not know what it is reading from.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createBundleHandler, ASSET_PREFIX } from 'telamon/server';
import { databaseSource } from 'telamon/db';

const PORT = Number(process.env.PORT) || 3000;
const CONFIG = process.env.OKF_CONFIG || './okf.db.json';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://telamon:telamon@localhost:5432/telamon',
  max: Number(process.env.PG_POOL_MAX) || 4,
});

/** The seam: SQL in, rows out. Swapping Postgres for anything else swaps this. */
const query = async (sql, params) => (await pool.query(sql, params)).rows;

const source = databaseSource(JSON.parse(await readFile(CONFIG, 'utf8')), query, {
  name: 'postgres',
  // Postgres binds `$1`, not `?`. telamon has no way to know which engine it is
  // talking to, so it asks. Getting this wrong is a syntax error on the first
  // incremental read and never on the first full one, because a full read binds
  // nothing -- which is exactly the kind of bug that reaches production.
  placeholder: (index) => `$${index}`,
});

const handler = createBundleHandler({
  source,
  title: 'Acme metrics',
  onDiagnostics: ({ source: read, bundle }) => {
    for (const d of [...read, ...bundle]) {
      if (d.severity === 'warning') console.warn(`[okf] ${d.code}: ${d.message}`);
    }
  },
});

const ASSETS = {
  'enhance.js': ['telamon/enhance.js', 'text/javascript; charset=utf-8'],
  'styles.css': ['telamon/styles.css', 'text/css; charset=utf-8'],
  'tokens.css': ['telamon/tokens.css', 'text/css; charset=utf-8'],
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // Only the static files are ours; the rest of the prefix is the handler's.
  const asset = url.pathname.startsWith(`${ASSET_PREFIX}/`)
    ? ASSETS[url.pathname.slice(ASSET_PREFIX.length + 1)]
    : undefined;

  if (asset) {
    const [specifier, type] = asset;
    readFile(new URL(import.meta.resolve(specifier)))
      .then((body) => {
        res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=3600' });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(404).end('Not found');
      });
    return;
  }

  handler(new Request(url, { method: req.method, headers: req.headers }))
    .then(async (response) => {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    })
    .catch((error) => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal server error');
    });
});

// Read and parse before listening, so an unreachable database is a startup
// failure rather than a pod that passes its checks and fails live traffic.
try {
  await handler.warm();
} catch (error) {
  console.error(`cannot read the warehouse: ${error.message}`);
  process.exit(1);
}

// Freshness. `changedColumn` is declared on both mappings, so this asks for the
// rows whose `updated_at` moved and reparses only the documents that differ.
const REFRESH_MS = Number(process.env.REFRESH_MS) || 5_000;
const ticker = setInterval(async () => {
  try {
    const reparsed = await handler.refresh();
    if (reparsed > 0) console.log(`refresh: reparsed ${reparsed} document(s)`);
  } catch (error) {
    console.error(`refresh failed: ${error.message}`);
  }
}, REFRESH_MS);
ticker.unref?.();

// A watermark cannot see a deletion, and cannot see a transaction that commits
// late with an early stamp. Reconcile on a slower cycle underneath.
const reconciler = setInterval(() => {
  handler.refresh({ full: true }).catch((error) => console.error(`reconcile failed: ${error.message}`));
}, Number(process.env.RECONCILE_MS) || 300_000);
reconciler.unref?.();

server.listen(PORT, () => console.log(`serving Postgres on http://localhost:${PORT}`));

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    clearInterval(ticker);
    clearInterval(reconciler);
    handler.close();
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
