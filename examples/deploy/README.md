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

## Kubernetes

Manifests in [`k8s/`](./k8s): a Deployment, a Service, and an Ingress.

```bash
kubectl apply -f k8s/
```

The bundle is baked into the image, so a pod needs no volume, no init container, and nothing mounted. Publishing documentation is a build and a rollout, and rolling back is `kubectl rollout undo`.

### Probes

The server calls `handler.warm()` before it listens, so the port opening already means the bundle parsed. Readiness then points at `/_telamon/health`, which answers `503` while the bundle is unreadable and `200` once it is not — and shares the same cached read, so probing costs nothing after the first one.

Liveness is deliberately dumber: an open socket. Pointing liveness at `/health` too would restart a pod for being unable to reach its source, which is the one thing restarting cannot fix.

### Sizing

Memory is roughly **35× the markdown**, because parsed syntax trees are much larger than their source, and every replica pays it in full — nothing is shared between pods. Measured on a bundle of 2000 documents and 8 MB of markdown:

| | |
| --- | --- |
| idle, before the first request | 89 MB |
| after the read and parse | 288 MB |
| after the search index builds | 296 MB |
| after one `/graph` render | 384 MB |

Time, on the same bundle: the read and parse take **5.2 s** (paid at startup, by `warm()`), a warm page **150 ms**, the first search **148 ms** and every one after **4 ms**.

### Two things that will bite at this size

**`/graph` settles a force layout on every request** — **7.5 s** of CPU for 2000 nodes, synchronously, blocking every other request on that pod. Under a CPU limit it is worse. Cache it at the ingress, as the manifest does, or turn it off with `features: { graph: false }`.

**Pages grow with the sidebar**, which lists every document: 560 KB and 150 ms at 2000 documents. That is navigation, not content — the bundle still never travels — but it is the number to watch as a bundle grows, and the reason to think about how the tree is organised.

### If you move to a database source later

`handler.invalidate()` only affects the pod that received the call, so replicas will drift as the warehouse changes. Pick one: `noCache: true` and a query per request, a rolling restart when your pipeline publishes, or a Job that fans out to each pod.

## Docker

```bash
docker build -t acme-analytics .
docker run -p 3000:3000 acme-analytics
```

One change first: this example depends on `telamon` as `workspace:*`, which npm cannot resolve inside an image. Point it at a published version and the build works as written.

The image carries the bundle. Pointing at a database instead means the image carries no content at all — it reads the warehouse at request time, and shipping new documentation stops being a deploy.
