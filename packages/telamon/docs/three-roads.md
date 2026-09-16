# Three roads

telamon renders an OKF bundle. How that bundle reaches a reader is a separate
decision, and there are three answers. They differ by an order of magnitude in
what they cost and what they demand of you, and picking the wrong one is the
kind of mistake you discover late — from a reader on a bad connection, or from
a stale page nobody can explain.

This guide is here so you pick once, on purpose.

---

## The question that decides it

Everything else is detail:

> **Does your content change when you deploy, or independently of it?**

If documents live in a repository and a commit is what publishes them, the
answer is *when you deploy*. Your CI already rebuilds on push, so freshness is
a deployment concern and you need no process at all — a directory of static
files is the whole product.

If documents live somewhere that changes on its own — a warehouse, a CMS, a
database a data team writes to — the answer is *independently*. Nothing you
deploy can be current, so something has to read the source at request time.

That splits the three roads into two groups, and a second question splits the
first group:

```
Does content change on deploy, or on its own?
│
├── On deploy ──────► How much markdown is it?
│                     │
│                     ├── Under ~10 MB ──► Road 1: ship the corpus
│                     └── More than that ► Road 2: ship an index
│
└── On its own ─────► Road 3: run a server
```

The size threshold is not a cliff, and [Road 2](#road-2-ship-an-index) explains
how to find yours. But if you are under a few megabytes of markdown, stop
reading and take Road 1: it is the simplest thing that works, and the other two
exist to solve problems you do not have.

---

## At a glance

Measured on the same corpus throughout: 2009 documents, 33 MB of markdown,
snowball-sampled from eight Wikipedias so the text is genuinely varied. Timings
are on a desktop CPU over loopback, so **network time is additional** — the
transfer column says how much.

| | Road 1: corpus | Road 2: index | Road 3: server |
| --- | --- | --- | --- |
| **What ships** | static files | static files | a process |
| **First-load JS** | 44.6 MB | 3.0 MB | none |
| **Over the wire** | 14.0 MB gz | 0.69 MB gz | ~30 KB/page |
| **Transfer @ 25 Mbps** | +4.5s | +0.2s | negligible |
| **Time to first render** | 31.5s | 3.5s | ~50ms |
| **Build time** | 155s | 14s | n/a |
| **Navigation** | free | ~40ms + one chunk | a request |
| **Memory** | the reader's | the reader's | ~330 MB steady |
| **Content freshness** | on deploy | on deploy | seconds |
| **Full-text search** | complete | read documents only | complete |
| **Needs a runtime?** | no | no | yes |
| **Needs a database?** | no | no | optional |

A corpus one tenth this size costs roughly one tenth as much on Roads 1 and 2 —
the relationship is linear in bytes, not in document count. See
[Sizing](#sizing-your-own-bundle).

---

## Road 1: ship the corpus

**The bundler inlines every document, and the artifact is a directory.**

Vite reads the markdown at build time and compiles it into the JavaScript, so
there is no server, no database, no fetch after the first load, and nothing that
knows what an OKF document is. Navigation after first paint costs nothing
because everything is already in memory.

### Choose it when

- Documents live in a repository and CI rebuilds on push.
- The corpus is small — under roughly 10 MB of markdown.
- You would rather deploy a directory than operate a process.

### What it costs

First load carries the whole corpus, and grows with it. That is the entire
trade, and it is a good one while the corpus is small: at 3 MB of markdown the
first render is 2.5s and every click afterwards is instant.

### Build it

```ts
// src/bundle.ts
const modules = import.meta.glob('../bundle/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const BUNDLE = Object.fromEntries(
  Object.entries(modules).map(([path, text]) => [path.slice('../bundle/'.length), text]),
);
```

```tsx
import { OkfSite } from 'telamon';
import { BUNDLE } from './bundle.js';

createRoot(root).render(<OkfSite bundle={BUNDLE} title="Our knowledge bundle" />);
```

Complete example: [`examples/spa`](../../../examples/spa).

### Guard it

The corpus grows a document at a time and nothing in the build says so. Add the
budget and find out in CI instead of from a reader:

```ts
import { okfBudget } from 'telamon/vite';

export default defineConfig({
  plugins: [react(), okfBudget({ max: '1 MB' })],
});
```

This is the single most valuable thing on this page for a Road 1 project. It is
what turns "we outgrew this eighteen months ago" into a failed build on the
commit that did it.

---

## Road 2: ship an index

**The bundler inlines frontmatter and splits every body into its own chunk.**

Everything that needs the *whole* bundle — the navigation tree, the search
index, the graph, backlinks — is built from frontmatter and links: from what a
document *is* and what it points at. Only the body of the document on screen
needs a body.

On the measured corpus, **frontmatter is 5.4% of the bytes**. So the first load
carries an index of the corpus, and each navigation fetches one document.

### Choose it when

- Documents still live in a repository and CI still rebuilds on push.
- The corpus is too big for Road 1 — first load is seconds and climbing.
- You still want the artifact to be a directory of static files.

### What it costs

- **A navigation to an unread document is no longer free.** ~40ms, of which
  ~15ms is parsing the document and ~25ms is recomputing what depends on the
  whole bundle. It does not grow as you read — the same on the first document
  and the hundredth — but it does grow with corpus size.
- **Full-text search only covers what has been read.** Titles, descriptions,
  types and tags are complete from the first render because they are
  frontmatter. Prose is not in the bundle until its document has been opened.
  If search over bodies matters more than first load, take Road 1 and raise the
  budget.
- **Thousands of files instead of three.** Fine for any static host; worth
  knowing if something in your pipeline counts files.

### Build it

```ts
// vite.config.ts
import { okfBudget, okfManifest } from 'telamon/vite';

export default defineConfig({
  plugins: [
    react(),
    okfManifest({ dir: './bundle' }),
    okfBudget({ max: '1 MB' }),
  ],
});
```

```tsx
/// <reference types="telamon/vite-client" />
import { OkfSite, useLazyBundle } from 'telamon';
import { BODIES, MANIFEST } from 'virtual:okf-manifest';

function Docs() {
  const { bundle, onNavigate } = useLazyBundle({ manifest: MANIFEST, bodies: BODIES });
  return <OkfSite bundle={bundle} onNavigate={onNavigate} title="Our knowledge bundle" />;
}
```

`MANIFEST` is every document's frontmatter, inlined. `BODIES` is a loader per
document that compiles to a dynamic import, so each body is its own hashed
chunk. Both are keyed by bundle-relative path. The dev server watches the
directory and reloads on a change, because frontmatter decides routes and the
tree — a new document is a different site, not a different component.

Complete example: [`examples/spa-lazy`](../../../examples/spa-lazy), and see
[the worked example](#worked-example-telamon-spa-lazy) below.

---

## Road 3: run a server

**The server holds the bundle and sends rendered pages.**

No bundle reaches the browser. A page weighs what the page weighs, whether the
bundle holds ten documents or ten thousand. The three features that want the
whole corpus are answered by the server: search is a form that submits to
`/search`, the navigation tree serves one level at a time, and the graph is
drawn before the page is sent.

### Choose it when

- Content changes independently of deploys — a warehouse, a CMS, a database.
- Freshness is measured in seconds or minutes, not deploys.
- The corpus is large enough that shipping even an index is wrong.
- You need full-text search over everything, always.

### What it costs

You are operating a process: memory, probes, restarts, a rollout. On the
measured corpus it warms in ~30s and settles at ~330 MB (~470 MB once the graph
has been rendered), with a transient ~724 MB high-water during the parse. Size
for the peak.

### Build it

```ts
import { createBundleHandler } from 'telamon/server';
import { fileSource } from 'telamon/source';

const handler = createBundleHandler({
  source: fileSource('./bundle'),
  title: 'Our knowledge bundle',
});
```

It takes and returns web-standard `Request`/`Response`, so it runs anywhere that
speaks fetch. `npx telamon serve ./bundle` is the same handler for local use.

Swap the source and nothing else changes:

```ts
import { databaseSource } from 'telamon/db';

const source = databaseSource(config, (sql, params) => db.prepare(sql).all(...params));
```

### Freshness

A database source that declares `changedColumn` can be asked what changed
rather than re-read:

```ts
setInterval(() => handler.refresh(), 10_000);
```

`refresh()` re-reads only rows past its watermark and re-parses only the
documents whose text actually differs. Measured on the same corpus: editing one
row costs **515ms end to end** where a full re-read costs 30 seconds. Run
`refresh({ full: true })` on a slower cycle underneath — a watermark cannot see
a deletion, and cannot see a transaction that commits late with an early
timestamp.

Complete example: [`examples/deploy`](../../../examples/deploy), and
[`examples/db-sync`](../../../examples/db-sync) for the mapping.

---

## Worked example: `telamon-spa-lazy`

Road 2, stood up end to end, on a corpus chosen to be hostile.

### The corpus

2000 articles snowball-sampled from eight Wikipedias — English, German,
Japanese, Russian, Chinese, Arabic, Hindi, Greek — following real inter-article
links so the graph is real rather than generated. 33 MB of markdown, 35,548
links, an average of 17 KB per document.

That average is the point: real OKF documents run 2–4 KB, so this corpus is
roughly **six times heavier per document** than what you are likely to have. It
was picked to find breaking points, and it found several — non-Latin titles,
percent-encoded links, and the first-load cost this guide is about.

### The image

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
# okfManifest reads this at build time. It is not in the image that runs.
COPY bundle ./bundle
# okfBudget runs here: a build that inlined the corpus fails at this line.
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Owned by the user that runs it: vite writes into node_modules at startup.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./
EXPOSE 3000
USER node
CMD ["npm", "run", "preview"]
```

```bash
docker build -t telamon-spa-lazy .
docker run --rm -p 8882:3000 telamon-spa-lazy
```

Two details that cost a first attempt each, both worth copying:

- **`--chown=node:node` on `node_modules`.** `vite preview` writes into
  `node_modules/.vite-temp` at startup, and a root-owned tree is an immediate
  `EACCES` once you drop to `USER node`.
- **No `vite.config.ts` in the runtime stage.** `preview` serves `dist` by
  default, and loading a TypeScript config makes Vite transpile it to a temp
  file first — which is both that write and pointless work for settings that
  only applied to the build.

### What it produced

| | |
| --- | --- |
| entry chunk | 3.0 MB (0.69 MB gzipped) |
| body chunks | 2011, median 16 KB, none fetched until opened |
| build | 14s, 2408 modules |
| first render | 3.5s |
| `/graph` | 2009 nodes and 59,032 edges, drawn from frontmatter alone |

The same corpus inlined is 44.6 MB, 14 MB gzipped, and 31.5 seconds. The
`okfBudget({ max: '1 MB' })` in the config passes the split build at 669 KB and
fails the inlined one — which is the distinction worth enforcing in CI.

### Serving it for real

`vite preview` is Vite's own preview server, not a production one. The artifact
is static files, so any host serves the same `dist/` given the SPA fallback that
client-side routing needs — a reload on `/en/science` has to return
`index.html`:

| host | rewrite |
| --- | --- |
| nginx | `try_files $uri /index.html;` |
| S3 + CloudFront | error document → `/index.html` |
| GitHub Pages | copy `index.html` to `404.html` |
| Netlify / Vercel | `/* /index.html 200` |

---

## Sizing your own bundle

The cost on Roads 1 and 2 tracks **total markdown bytes, not document count**.
Holding the count at 2000 and varying document size:

| 2000 documents at | markdown | entry JS | first render |
| --- | --- | --- | --- |
| 2.5 KB each | 12 MB | 9.6 MB | 5.7s |
| 6 KB each | 20 MB | 16.6 MB | 7.8s |
| 17 KB each (this corpus) | 33 MB | 44.6 MB | 31.5s |

2000 small documents beat 500 large ones. Rules of thumb from the same
measurements:

- Entry JS ≈ **0.9×** your markdown, inlined.
- Gzipped ≈ **0.3×** the JS.
- First render ≈ **0.7s per MB** of JS, on a desktop CPU.
- Add transfer: gzipped MB × 8 ÷ your bandwidth in Mbps.

So: `du -sh` your bundle directory. Under ~5 MB, Road 1 is comfortable
anywhere. Around 10 MB it is a judgement call about your readers' connections.
Above that, Road 2.

---

## How to tell you chose wrong

| Symptom | What it means | Where to go |
| --- | --- | --- |
| First load takes seconds and is getting worse | Road 1 outgrown | Road 2 |
| CI build time dominated by the bundler | Road 1 outgrown | Road 2 |
| Readers report stale pages after a data change | content changes off-deploy | Road 3 |
| Search misses text you know exists | Road 2's bodies are unread | Road 1, or a build-time index |
| Paying for a process that serves unchanging files | Road 3 not needed | Road 1 or 2 |
| Pod memory climbing with corpus size | Road 3, sized for the old corpus | raise limits; see [Road 3](#road-3-run-a-server) |

Moving between Roads 1 and 2 is a `vite.config.ts` change and about ten lines of
app code — the bundle on disk does not change at all. Moving to or from Road 3
changes how you deploy but not the bundle either: every road reads the same OKF
directory.

That is the one guarantee worth remembering. **Your content is not coupled to
this decision**, so making it wrong the first time is cheap to fix.
