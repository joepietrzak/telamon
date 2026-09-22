import { readFile, readdir, stat } from 'node:fs/promises';
import { type ServerResponse } from 'node:http';
import { join, relative, resolve, sep } from 'node:path';
import { type Plugin } from 'vite';

/** What `GET /api/metrics` answers. */
export interface Metrics {
  /** Documents in the bundle. `index.md` and `log.md` are structure, not documents. */
  documents: number;
  /** Their markdown, in bytes. */
  bytes: number;
  /** One row per top-level directory. In the Wikipedia corpus, one per language. */
  directories: { name: string; documents: number; bytes: number }[];
  /** When the bundle was counted: per request under `vite`, at build time otherwise. */
  countedAt: string;
}

const RESERVED = new Set(['index.md', 'log.md']);

/** Where the build leaves its count, inside `dist/`. */
const COUNTED = 'metrics.json';

async function count(dir: string): Promise<Metrics> {
  const rows = new Map<string, { documents: number; bytes: number }>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const name = entry.name.toLowerCase();
    if (!entry.isFile() || !name.endsWith('.md') || RESERVED.has(name)) continue;
    const file = join(entry.parentPath, entry.name);
    // A document at the root has no directory, and `.` is what a path calls that.
    const top = relative(dir, entry.parentPath).split(sep)[0] || '.';
    const row = rows.get(top) ?? { documents: 0, bytes: 0 };
    row.documents += 1;
    row.bytes += (await stat(file)).size;
    rows.set(top, row);
  }

  const directories = [...rows]
    .map(([name, row]) => ({ name, ...row }))
    .sort((a, b) => b.documents - a.documents || a.name.localeCompare(b.name));
  return {
    documents: directories.reduce((sum, row) => sum + row.documents, 0),
    bytes: directories.reduce((sum, row) => sum + row.bytes, 0),
    directories,
    countedAt: new Date().toISOString(),
  };
}

function send(res: ServerResponse, json: string): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Any origin may read this: it describes a site anyone can already open, and
  // being read from another origin is what it is for.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(json);
}

/**
 * `GET /api/metrics`, from whichever Vite is serving the site.
 *
 * Under `vite` the markdown is on disk, so every request counts it again and a
 * new document shows up on the next fetch. `vite preview` has no markdown to
 * count -- the image that runs carries `dist/` and nothing else -- so the build
 * counts once and ships the answer inside `dist/`, and the server reads that.
 * The numbers are as fresh as the site, because they come from the same build.
 *
 * Middleware added in these hooks runs before Vite's own, so the SPA fallback
 * never gets the chance to answer `/api/metrics` with `index.html`.
 */
export function metricsApi(options: { dir: string }): Plugin {
  return {
    name: 'spa-lazy:metrics-api',

    async generateBundle() {
      const metrics = await count(options.dir);
      this.emitFile({ type: 'asset', fileName: COUNTED, source: JSON.stringify(metrics) });
    },

    configureServer(server) {
      server.middlewares.use('/api/metrics', (_req, res, next) => {
        count(options.dir).then((metrics) => send(res, JSON.stringify(metrics)), next);
      });
    },

    configurePreviewServer(server) {
      const file = resolve(server.config.root, server.config.build.outDir, COUNTED);
      // Read once, on the first request: it cannot change without a rebuild.
      let counted: Promise<string> | undefined;
      server.middlewares.use('/api/metrics', (_req, res, next) => {
        counted ??= readFile(file, 'utf8');
        counted.then((json) => send(res, json), next);
      });
    },
  };
}
