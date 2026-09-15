// A deployable telamon server.
//
// The whole thing is below, and most of it is the Node adapter -- turning
// Node's request into a web `Request` and writing the `Response` back. On a
// runtime that already speaks fetch (Workers, Deno, Bun) the adapter goes away
// and `export default { fetch: handler }` is the entire file.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createBundleHandler, ASSET_PREFIX } from 'telamon/server';
import { fileSource } from 'telamon/source';

const PORT = Number(process.env.PORT) || 3000;
const BUNDLE = process.env.BUNDLE_DIR || './bundle';

// Swap this for `databaseSource(config, query)` and the same server reads a
// warehouse instead. Nothing below changes.
const source = fileSource(BUNDLE, {
  ignore: ['**/drafts/**'],
});

const handler = createBundleHandler({
  source,
  title: 'Acme analytics',

  // Content problems are the bundle author's to fix, and a server that
  // swallows them is how a broken link survives to production.
  onDiagnostics: ({ source: read, bundle }) => {
    for (const d of [...read, ...bundle]) {
      if (d.severity === 'warning') console.warn(`[okf] ${d.code}: ${d.message}`);
    }
  },
});

// The stylesheets and the enhancement script. In front of a CDN you would
// serve these from it instead and point `stylesheets` at the CDN URLs.
const ASSETS = {
  'enhance.js': ['telamon/enhance.js', 'text/javascript; charset=utf-8'],
  'styles.css': ['telamon/styles.css', 'text/css; charset=utf-8'],
  'tokens.css': ['telamon/tokens.css', 'text/css; charset=utf-8'],
};

const assetPath = (specifier) => new URL(import.meta.resolve(specifier));

createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // Only the static files are ours; everything else under the prefix is the
    // handler's -- search.json and bundle.zip live there.
    const asset = url.pathname.startsWith(`${ASSET_PREFIX}/`)
      ? ASSETS[url.pathname.slice(ASSET_PREFIX.length + 1)]
      : undefined;

    if (asset) {
      const [specifier, type] = asset;
      // Read first: once `writeHead` has run the status is spent, and a failure
      // after it would be answered as a 200 with an error page in the body.
      const contents = await readFile(assetPath(specifier));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=3600' });
      res.end(contents);
      return;
    }

    const response = await handler(
      new Request(url, { method: req.method ?? 'GET', headers: new Headers(req.headers) }),
    );

    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  })().catch((error) => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal server error');
  });
}).listen(PORT, () => {
  console.log(`serving ${BUNDLE} on http://localhost:${PORT}`);
});
