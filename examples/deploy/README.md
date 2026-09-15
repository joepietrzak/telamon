# deploy

What it actually looks like to put a bundle on the internet.

```bash
pnpm --filter telamon build     # the server imports the built package
pnpm --filter deploy-example start
#   serving ./bundle on http://localhost:3000
```

## What's here

| | |
| --- | --- |
| `server.mjs` | The whole server. Forty lines, and most of them are the Node adapter. |
| `bundle/` | A small OKF bundle — three metrics and a table, with frontmatter worth rendering. |
| `Dockerfile` | Node, the server, the bundle. Nothing else. |

## The part that is telamon

Two calls:

```js
const source = fileSource('./bundle', { ignore: ['**/drafts/**'] });
const handler = createBundleHandler({ source, title: 'Acme analytics' });
```

Everything after that is plumbing `Request` in and `Response` out. On a runtime that already speaks fetch — Workers, Deno, Bun — the plumbing disappears:

```js
export default { fetch: handler };
```

Swapping the filesystem for a warehouse is one line, and nothing downstream notices:

```js
import { databaseSource } from 'telamon/db';

const source = databaseSource(config, (sql, params) => pool.query(sql, params));
```

## What it costs

Measured against the bundle in this directory, on a laptop:

| | |
| --- | --- |
| a concept page | **5.3 KB** of HTML, complete and readable |
| JavaScript per page | **3 KB**, once, cached — and optional |
| first byte, cold | **~7 ms** |
| first byte, warm | **~4 ms** |
| the `/graph` page | **~50 ms** — it settles a force layout before answering |
| resident memory | **~94 MB**, which is Node being Node |

The page carries no bundle, so those numbers are about the page rather than the corpus. A bundle a hundred times larger serves the same 5.3 KB page; what grows is the sidebar, which lists every document.

The bundle is read once and cached. `fileSource` watches the directory, so editing a file invalidates the cache without a restart — useful in development, harmless in a container where nothing edits anything.

## Things worth deciding before you ship

**Serve the assets from a CDN.** This server reads the two stylesheets and the enhancement script off disk. In front of a CDN, point the handler at it instead and let it cache them:

```js
createBundleHandler({ source, stylesheets: ['https://cdn.example.com/okf/styles.css'] });
```

**Decide what a diagnostic means to you.** The handler reports everything the read and the parse found. This example logs warnings. A stricter deployment refuses to start on a broken link; a looser one ships them to your error tracker and carries on.

**A database source has no `watch`.** It is re-read only when something invalidates it, so a long-lived server will serve the bundle it loaded at boot. Either call `handler.invalidate()` when your pipeline finishes writing, or set `noCache: true` and pay a query per request.

**The graph settles a layout per request.** Fine for a bundle this size, and the first thing to put behind a cache header if your graph is large.

## Docker

```bash
docker build -t acme-analytics .
docker run -p 3000:3000 acme-analytics
```

One change first: this example depends on `telamon` as `workspace:*`, which npm cannot resolve inside an image. Point it at a published version and the build works as written.

The image carries the bundle. Pointing at a database instead means the image carries no content at all — it reads the warehouse at request time, and shipping new documentation stops being a deploy.
