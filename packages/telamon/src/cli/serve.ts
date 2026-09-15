import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileSource } from '../source/file.js';
import { ASSET_PREFIX, createBundleHandler } from '../server/index.js';
import type { ServeArgs } from './args.js';

/**
 * Static assets the CLI serves alongside the site: the prebuilt client script
 * and the two stylesheets, which sit next to this file once built.
 */
const ASSETS: Record<string, string> = {
  // tsup suffixes an IIFE build with `.global`.
  'enhance.js': '../enhance.global.js',
  'styles.css': '../styles.css',
  'tokens.css': '../tokens.css',
};

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** Node's request object, as a web `Request`. */
function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else if (value !== undefined) headers.set(key, value);
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  // Only GET and HEAD reach the handler, so there is never a body to forward.
  return new Request(url, { method: req.method ?? 'GET', headers });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  const body = Buffer.from(await response.arrayBuffer());
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(body);
}

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

export async function serve(args: ServeArgs): Promise<RunningServer> {
  const source = fileSource(args.dir);

  // Fail before listening rather than on the first request: a mistyped path
  // should not look like a working server that 500s.
  const first = await source.load();
  for (const diagnostic of first.diagnostics) {
    console.warn(`  ${diagnostic.severity}: ${diagnostic.message}`);
  }
  console.log(`  ${Object.keys(first.files).length} files from ${source.name}`);

  const handler = createBundleHandler({
    source,
    enhance: args.enhance,
    ...(args.basename !== undefined && { basename: args.basename }),
    ...(args.title !== undefined && { title: args.title }),
    onDiagnostics: ({ source: sourceDiagnostics, bundle }) => {
      for (const diagnostic of [...sourceDiagnostics, ...bundle]) {
        if (diagnostic.severity === 'warning') {
          console.warn(`  ${diagnostic.code}: ${diagnostic.message}`);
        }
      }
    },
  });

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const path = new URL(req.url ?? '/', 'http://localhost').pathname;

        // Only the static files are ours. The rest of the prefix belongs to the
        // handler's endpoints -- search.json, bundle.zip -- and intercepting
        // those here would 404 them before they were ever reached.
        const asset = path.startsWith(`${ASSET_PREFIX}/`)
          ? ASSETS[path.slice(ASSET_PREFIX.length + 1)]
          : undefined;

        if (asset) {
          const contents = await readFile(new URL(asset, import.meta.url));
          res.writeHead(200, {
            'content-type': CONTENT_TYPES[extname(asset)] ?? 'application/octet-stream',
            'cache-control': 'no-cache',
          });
          res.end(contents);
          return;
        }

        await send(res, await handler(toRequest(req)));
      } catch (error) {
        console.error(error);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('Internal server error');
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(args.port, args.host, resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : args.port;
  const url = `http://${args.host}:${port}${args.basename ?? ''}`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        handler.close();
        server.close(() => resolve());
      }),
  };
}
