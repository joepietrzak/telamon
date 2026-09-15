// Sync a SQLite warehouse into an OKF bundle.
//
// The whole database-specific part of this script is `query` -- fourteen lines
// down from here. telamon hands it SQL and takes rows back; swapping SQLite for
// Postgres means swapping that function, not this file.

import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBundle } from 'telamon/db';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'bundle');

const db = new DatabaseSync(':memory:');
db.exec(await readFile(join(here, 'warehouse.sql'), 'utf8'));

/** The seam: SQL in, rows out. Nothing telamon-specific about it. */
const query = (sql, params) => db.prepare(sql).all(...params);

const config = JSON.parse(await readFile(join(here, 'okf.db.json'), 'utf8'));
const { files, diagnostics } = await loadBundle(config, query);

await rm(outDir, { recursive: true, force: true });
for (const [path, contents] of Object.entries(files)) {
  const target = join(outDir, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

const paths = Object.keys(files).sort();
console.log(`\nwrote ${paths.length} files to ${outDir}\n`);
for (const path of paths) console.log(`  ${path}`);

if (diagnostics.length > 0) {
  console.log('\ndiagnostics:\n');
  for (const d of diagnostics) {
    console.log(`  [${d.severity}] ${d.code}: ${d.message}`);
  }
}

// `internal_scratch_metric` is in the table but not the bundle: the mapping's
// `where` clause is the publication gate, so drafts stay in the warehouse.
console.log(
  `\nmetrics in the database: ${db.prepare('select count(*) as n from metric_definitions').get().n}` +
    `, in the bundle: ${paths.filter((p) => p.startsWith('metrics/') && !p.endsWith('index.md')).length}\n`,
);

db.close();
