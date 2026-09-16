# telamon

Render a [Google Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format) (OKF) bundle as a React single-page app.

An OKF bundle is a directory tree of markdown files with YAML frontmatter. `telamon` turns one into a browsable site: **routing comes from the directory structure**, **each page is the rendered markdown of one file**, and the OKF-specific frontmatter — provenance, trust, lifecycle — becomes page chrome.

It ships structure, not taste. Every visual value comes from a `--okf-*` CSS custom property, so you bring your own design tokens and get your own look without forking a single component.

Implements OKF **v0.2**.

```bash
npm install telamon
```

`react` and `react-dom` (>= 18) are peer dependencies.

**New here? Start with the [getting-started guide](./docs/getting-started.md)** — a walkthrough from loading a bundle to theming and serving it. This README is the reference.

**Deciding how to ship it? Read [three roads](./docs/three-roads.md)** — the choice between compiling the corpus into a static build, shipping an index of it, or running a server, with what each one measured on the same 2000-document bundle.

## Quick start

```tsx
import { OkfSite } from 'telamon';
import 'telamon/tokens.css'; // optional: the default token values
import 'telamon/styles.css'; // required: structure, all of it token-driven

// Whatever gets you a { path: contents } map. With Vite:
const modules = import.meta.glob('./bundle/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const bundle = Object.fromEntries(
  Object.entries(modules).map(([path, text]) => [path.replace('./bundle/', ''), text as string]),
);

export function App() {
  return <OkfSite bundle={bundle} title="Our knowledge bundle" />;
}
```

That is the whole integration. `telamon` takes an **in-memory** bundle and does not fetch anything itself, so loading is your app's decision — a build-time glob, a `fetch` loop, a CMS, a git API. Anything that produces `Record<string, string>` works.

## Routing

Directories under the bundle root *are* the routes.

| File | Route |
| --- | --- |
| `index.md` | `/` |
| `tables/index.md` | `/tables` |
| `tables/events_.md` | `/tables/events_` |
| `references/metrics/purchasers.md` | `/references/metrics/purchasers` |
| `log.md` | `/log` |

Details that matter in practice:

- All three OKF link forms resolve: bundle-absolute (`/tables/events_.md`), explicitly relative (`./x.md`, `../y/x.md`), and bare relative (`x.md`). Fragments survive: `events_.md#schema` becomes `/tables/events_#schema`.
- A directory with no `index.md` still gets a route, rendering a generated listing of its children.
- If `foo/index.md` and `foo.md` both exist, the directory index wins and a `route-collision` diagnostic is emitted.
- Links inside the bundle become client-side navigations but keep a real `href`, so they stay copyable and open in a new tab on ⌘-click. External links get `target="_blank"` and `rel="noreferrer noopener"`.
- The default router uses the History API. Serve `index.html` for unmatched paths, or pass a different router (below).

## Bringing your own design tokens

`styles.css` never hardcodes a value. Every declaration reads a `--okf-*` custom property with an inline fallback, and every rule is scoped under `.okf-root`. So:

- **Import `tokens.css` and override some of it** to start from a working default;
- **or skip `tokens.css` entirely** and define the token set yourself.

```css
:root {
  --okf-font-sans: 'Söhne', system-ui, sans-serif;
  --okf-color-accent: #8a3324;
  --okf-color-bg: #fbf7ef;
  --okf-radius-md: 0;
  --okf-content-max: 42rem;
}
```

Tokens cover type (`--okf-font-*`, `--okf-text-*`, `--okf-leading*`, `--okf-weight-*`), space (`--okf-space-1`…`-8`), shape (`--okf-radius-*`, `--okf-border-width`, `--okf-shadow-*`), layout (`--okf-sidebar-width`, `--okf-content-max`, `--okf-header-height`, …), colour (`--okf-color-*`), and the graph palette (`--okf-graph-node-0`…`-7`). See [`src/styles/tokens.css`](./src/styles/tokens.css) for the full set.

`tokens.css` ships a dark palette under `prefers-color-scheme: dark`, plus an explicit `[data-okf-theme="dark"|"light"]` override on the root element.

For a utility-class framework, use `classNames` instead — each entry is *merged with* the default `okf-*` class rather than replacing it:

```tsx
<OkfSite bundle={bundle} classNames={{ main: 'prose lg:prose-lg', sidebar: 'text-sm' }} />
```

And when markup itself needs to change, replace a whole region with a slot:

```tsx
<OkfSite
  bundle={bundle}
  components={{
    Header: ({ title }) => <MyHeader>{title}</MyHeader>,
    Footer: () => <MyFooter />,
  }}
  markdownComponents={{ blockquote: Callout }}
/>
```

Slots: `Header`, `Sidebar`, `Breadcrumbs`, `ConceptHeader`, `SourcesList`, `Relationships`, `Toc`, `Backlinks`, `SearchBox`, `Graph`, `ReferencesToggle`, `NotFound`, `Footer`. Define them outside render, or memoize them — a new function identity each render remounts that region.

## What you get out of the box

- **Frontmatter chrome** — type badge, tags, `draft`/`deprecated` banners, a stale warning once `now >= stale_after`, a trust badge derived from `verified` (SPEC §5.3), a "generated by" line, and a `sources` list anchored so `[^id]` footnotes and frontmatter entries describe the same material.
- **Navigation** — a sidebar built from the directory tree, ordered by each `index.md`'s own link order and descriptions where present, alphabetical where not. Plus breadcrumbs and an on-page table of contents.
- **Search** — a dependency-free index over titles, descriptions, tags, types, headings, and body text (code fences included: in a data bundle the SQL is often the thing worth finding). Opens with `/` or ⌘K. The index is built on first use, so a site that never searches never pays for it.
- **Typed relationships** — see below.
- **Backlinks and a concept graph** — a "Referenced by" panel on every page, and a force-directed graph at `/graph`. In an app the graph is code-split, so `d3-force` never lands in your main chunk; on a served site it arrives already drawn. Either way it ships an equivalent text listing for keyboard and screen-reader use.
- **A references toggle** — see below.
- **Sources** — read a bundle from a directory or out of a database, behind one interface. See below.
- **A server and a CLI** — `npx telamon serve ./bundle` to read one locally, and the same handler deployed so others can. See below.
Turn any of it off with `features={{ search: false, graph: false, backlinks: false, toc: false, referenceToggle: false }}`.

## Hiding provenance-only concepts

Bundles often carry concepts that exist only to hold source provenance for other concepts and say nothing substantive on their own. A sidebar checkbox hides them, along with their search results.

Hiding is presentational. Those pages stay routable, links from other concepts still resolve, backlinks *from* them still show, and they stay in the concept graph — nothing becomes unreachable, it just stops competing for attention.

By default a concept counts as a reference if it lives under a `references/` directory, at any depth. Bundles vary, so the rule is a prop:

```tsx
// by frontmatter type instead
<OkfSite bundle={bundle} isReference={(doc) => doc.frontmatter.type === 'Reference'} />

// or several types
const PROVENANCE = new Set(['Reference', 'Citation', 'Source']);
<OkfSite bundle={bundle} isReference={(doc) => PROVENANCE.has(doc.frontmatter.type ?? '')} />
```

Start with them hidden, or drive the state yourself:

```tsx
<OkfSite bundle={bundle} defaultShowReferences={false} />

<OkfSite
  bundle={bundle}
  showReferences={show}                       // controlled
  onShowReferencesChange={setShow}            // persist it wherever you like
/>
```

When references are hidden and a search would have matched one, the dialog says so and offers to reveal them, rather than reporting no matches for something the bundle does contain.

The control renders inside the sidebar region but outside the `Sidebar` slot, so replacing the sidebar keeps it. To place it yourself, render `<ReferencesToggle />` and read the state with `useReferences()`.

## Typed relationships

OKF gives cross-links no semantics: "all links assert untyped relationships; semantics appear in the surrounding prose" (SPEC §6). So the graph built from body links can only say *these two concepts are connected*, never *how*.

A bundle that wants to say how can carry a `relationships` key in frontmatter. It is not part of the spec, but §11 explicitly permits it — a consumer must not reject a bundle for keys it does not model.

```yaml
---
type: Metric
title: Purchasers
relationships:
  - type: depends_on
    target: /tables/events_.md
    description: Reads the raw event stream.
  - type: derived_from
    target: ../references/metrics/base.md
  - type: documented_by
    target: https://example.com/handbook
---
```

`target` accepts the same three forms as an OKF cross-link — bundle-absolute, `./relative`, and bare relative — resolved against the declaring document's directory. `type` and `description` are optional and neither is validated against any list.

What you get:

- **A directed, labelled edge in the graph.** Body links stay undirected lines; a relationship is drawn with an arrowhead and its type. `A depends_on B` and `B depends_on A` remain two distinct edges, and edges joining the same pair bow apart rather than stacking.
- **A Relationships section on the concept page**, listing each type, target, and description. It is a slot (`Relationships`), like any other region.
- **A backlink**, labelled with the relationship type, on the target's "Referenced by" list.
- **A diagnostic**, not an exception, when a target does not resolve (`broken-relationship`) or an entry is malformed (`invalid-relationship`). The rest of the entries still work, and the page still renders.

Read them yourself from `doc.frontmatter.relationships`, and the resulting edges from `bundle.graph.edges` — each carries `directed` and, for typed edges, `type`.

## Reading a bundle out of a database

A bundle is a filesystem, so pointing telamon at a database is a question of naming: which rows become which files, and which columns become frontmatter. That is data rather than code, so it lives in a JSON file you can keep beside the bundle and diff:

```json
{
  "okfVersion": "0.2",
  "title": "Acme analytics",
  "tables": [
    {
      "table": "analytics.metric_definitions",
      "path": "metrics/{metric_name}.md",
      "type": "Metric",
      "title": "display_name",
      "body": "definition_md",
      "frontmatter": {
        "description": "summary",
        "tags": "tags",
        "status": "lifecycle",
        "stale_after": "review_by"
      },
      "constants": { "generated": { "by": "process:warehouse-sync" } },
      "directory": { "title": "Metrics", "description": "Agreed definitions for the numbers leadership reads." },
      "where": "is_published",
      "orderBy": "metric_name"
    }
  ]
}
```

`telamon/db` is Node-side and driver-free. It hands you SQL and takes rows back, so the pool, the credentials, the retries, and the dialect all stay where they already are — and the same config works against Postgres, MySQL, SQLite, BigQuery, or anything else you can query:

```ts
import { loadBundle } from 'telamon/db';

const config = JSON.parse(await readFile('okf.db.json', 'utf8'));

export async function loader() {
  const { files, diagnostics } = await loadBundle(config, (sql, params) => pool.query(sql, params));
  return { files, diagnostics };
}

// -> <OkfSite bundle={files} />
```

What comes back is the same `Record<path, contents>` map `OkfSite` already takes, so routing, search, backlinks, and the graph work on a database-backed bundle exactly as on a checked-in one.

### The mapping

| Key | Type | Notes |
| --- | --- | --- |
| `table` | `string` | Source table, optionally schema-qualified. Plain identifiers only. |
| `sql` | `string` | Whole statement, for anything a table plus `where` cannot express. Wins over `table`. |
| `path` | `string` | Destination template. `{column}` is filled per row and slugified; at least one is required, or every row would collide. |
| `type` | `string` | Literal OKF `type` for every document the mapping produces. |
| `title` | `string` | Column holding the title. Falls back to the humanized filename. |
| `body` | `string` | Column holding the markdown body. |
| `template` | `string` | Body composed from `{column}` values, for tables that hold facts rather than prose. Wins over `body`. |
| `frontmatter` | `Record<string, string>` | Frontmatter key → column name. `null` columns are omitted rather than written empty. |
| `changedColumn` | `string` | Column that moves forward whenever a row changes — an `updated_at`, a version, a sequence. Declaring it on every mapping lets the source read only what changed. Cannot be combined with `sql`. |
| `json` | `string[]` | Columns holding JSON text, parsed before they become frontmatter. Postgres returns a real array for `tags`; SQLite, MySQL, and BigQuery return a string. |
| `constants` | `Record<string, unknown>` | Frontmatter key → fixed value, merged over the column-derived keys. |
| `directory` | `{ title?, description? }` | Describes the directory this mapping fills, for the generated indexes. |
| `where`, `orderBy`, `limit` | | Appended to the generated statement. |

Top level: `okfVersion`, `title` (the root heading, and so the site title), `generateIndexes`, and `tables`.

A worked example — a SQLite warehouse, the mapping above it, and a script that syncs one into a bundle — lives in [`examples/db-sync`](../../examples/db-sync).

### What it does with the rows

- **Indexes are synthesized** for the root and every mapped directory (SPEC §8), so the sidebar gets authored order and one-line descriptions rather than a bare directory listing. A mapping that writes its own `index.md` is left alone; `generateIndexes: false` turns the whole thing off.
- **Database types become YAML** — dates as ISO-8601, arrays as lists, `null` omitted, and JSON-text columns parsed where `json` names them.
- **A bad config throws**, at startup and before the database is touched: a mistyped table name is wiring, and failing loudly beats rendering a bundle quietly missing a table.
- **Bad data does not.** Each becomes a `DbDiagnostic` and the rest of the bundle still renders — the same bargain `parseBundle` makes. Codes: `missing-column`, `empty-path-segment`, `invalid-json`, `path-collision`, `empty-result`, `empty-body`.

## Shipping a bundle without shipping the corpus

A bundler that inlines an OKF bundle inlines all of it, which makes first load O(corpus). Measured on 2000 Wikipedia articles: 44.6 MB of JavaScript, 14 MB over the wire, and 31.5 seconds before anything is on screen — and that was over loopback, before any network.

Almost none of it is needed to draw a page. The navigation tree, the search index, the graph and backlinks are built from frontmatter and links — from what a document *is* and what it points at. Only the body of the document on screen needs a body, and on that corpus frontmatter is **5.4%** of the bytes.

`telamon/vite` splits the two:

```ts
// vite.config.ts
import { okfManifest } from 'telamon/vite';

export default defineConfig({
  plugins: [react(), okfManifest({ dir: './bundle' })],
});
```

```tsx
/// <reference types="telamon/vite-client" />
import { OkfSite, useLazyBundle } from 'telamon';
import { BODIES, MANIFEST } from 'virtual:okf-manifest';

export function Docs() {
  const { bundle, onNavigate } = useLazyBundle({ manifest: MANIFEST, bodies: BODIES });
  return <OkfSite bundle={bundle} onNavigate={onNavigate} />;
}
```

`MANIFEST` is every document's frontmatter, inlined. `BODIES` is a loader per document that compiles to a dynamic import, so each body is its own hashed chunk fetched on the navigation that wants it. Both are keyed by bundle-relative path. The dev server watches the directory and reloads when a document changes, because frontmatter decides routes and the tree — a new document is a different site, not a different component.

On the same 2000-document corpus:

| | inlined | split |
| --- | --- | --- |
| entry chunk | 44.6 MB | **3.0 MB** |
| over the wire (gz) | 14.0 MB | **0.69 MB** |
| `vite build` | 155s | **14s** |
| first render | 31.5s | **3.5s** |
| navigation to an unread document | free | ~40ms + one chunk |

Two things to know before choosing it:

- **Full-text search only covers what has been read.** Titles, descriptions, types and tags are complete from the first render because they are frontmatter; prose is not in the bundle until its document has been opened. Search over bodies needs the inlined build, or an index emitted at build time.
- **A navigation is no longer free**, though ~40ms is not far off. Roughly 15ms of that is parsing the document and 25ms is recomputing what depends on the whole bundle, which grows with the corpus.

A corpus small enough to ship whole should be shipped whole — under roughly 10 MB of markdown the inlined build stays near a second and every navigation is instant. Above that, this is how to keep a deployment that is a directory of static files rather than a process.

### Keeping it from coming back

A corpus compiled into an app grows a document at a time. Every commit looks fine, nothing in the build says otherwise, and the first person to notice is a reader on a bad connection. `okfBudget` puts the number in front of whoever added the document, in CI, while it is still cheap to decide about:

```ts
plugins: [react(), okfBudget({ max: '1 MB' })]
```

```
error during build:
[telamon:okf-budget] First load is 13.9 MB gzipped across 1 chunk, over the 1.00 MB budget.
  assets/index-Bj7s2S5p.js  13.9 MB
If a chunk that size is an OKF bundle compiled into the app, `okfManifest` from
telamon/vite and `useLazyBundle` ship the frontmatter and fetch each body on the
navigation that needs it.
```

It measures what a visitor must have before anything renders: entry chunks plus everything they reach by *static* import. A chunk behind `import()` is fetched by the navigation that needs it and is not counted — so on the same 2000-document corpus the inlined build fails this budget and the split one passes it at 669 KB, which is the distinction worth enforcing.

`measure: 'raw'` budgets the bytes on disk instead of the gzipped transfer; `action: 'warn'` reports without failing, for adopting a budget on a project that does not meet it yet. A malformed `max` throws when the plugin is created rather than at the end of a build.

## Serving a bundle

The library renders a bundle; where the files come from and who does the rendering are separate questions, and both have two answers.

Look at a bundle locally, with no build step and no configuration:

```bash
npx telamon serve ./bundle
#   14 files from ./bundle
#   http://localhost:3000
```

Or deploy one, so other people can read it:

```ts
import { fileSource } from 'telamon/source';
import { createBundleHandler } from 'telamon/server';

const handler = createBundleHandler({ source: fileSource('./bundle') });

export default { fetch: handler };            // a worker runtime
// or: createServer((req, res) => ...)        // Node, via the CLI's own adapter
```

The CLI is a thin wrapper over that same handler, so what you see locally is what you deploy.

### Sources

A `BundleSource` is anything that can produce a bundle's files. The handler takes one and never learns which it got:

```ts
import { fileSource } from 'telamon/source';
import { databaseSource } from 'telamon/db';

createBundleHandler({ source: fileSource('./bundle', { ignore: ['**/drafts/**'] }) });
createBundleHandler({ source: databaseSource(config, (sql, params) => pool.query(sql, params)) });
```

The interface is three members, so your own is not a large undertaking:

```ts
interface BundleSource {
  readonly name: string;
  load(): Promise<{ files: Record<string, string>; diagnostics: SourceDiagnostic[] }>;
  watch?(onChange: () => void): () => void;
}
```

`fileSource` implements `watch`, so `telamon serve` picks up edits without a restart. A source that does not is simply never invalidated.

### What reaches the visitor

The rendered page, and nothing else. No bundle, no corpus, no parse to redo in the browser.

That is the whole point of the server mode. Only two things ever want the entire bundle — search and the graph — and each is answered by the server instead:

| | |
| --- | --- |
| `GET /search?q=` | A rendered results page. The header search box is a real form that submits to it. |
| `GET /_telamon/search.json?q=` | The same results as JSON, for the enhancement script. |
| `GET /_telamon/health` | `200` once the bundle is loadable, `503` while it is not. For a readiness probe. |
| `GET /_telamon/nav.json?route=` | One level of the navigation tree, for the sidebar's expand control. |
| the graph | Rendered on the server at `graphRoute`, settled layout and all. |

So a page weighs what the page weighs. Growing every document in a bundle a thousandfold grows a served page by exactly one document — the one it renders.

What does grow is the sidebar, though not with the bundle: it renders the branch containing the current page, so the cost is the number of siblings along that path. A bundle of 2000 documents in one flat directory renders all 2000 of them; the same 2000 across fifty directories renders ninety-odd. Collapsed directories ship nothing, and the expand control fetches a level at a time from `/_telamon/nav.json`.

### Progressive enhancement, not hydration

Everything on a served page works with JavaScript switched off: search submits a form, the references toggle is a link that puts the state in the URL, and the graph is already drawn, every node a link you can click.

The enhancement script — a few kilobytes of plain DOM code, no React — upgrades that in place: the narrow-screen navigation button starts working, `/` and ⌘K focus the search box, results appear as you type instead of on submit, and the graph gains drag-to-pan and pinch-to-zoom. The graph needs no layout work to do it: the server ran the simulation and the coordinates are already in the markup, so panning moves a group that is already there rather than shipping d3 to compute one. Zoom is gated behind ctrl/⌘ the way a map embed gates it — a bare wheel belongs to the page, so nobody gets stuck scrolling past a tall graph — and a trackpad pinch already arrives as a ctrl-wheel, so it works without asking. It carries no bundle; the only thing it ever fetches is the result of a search someone actually typed. `enhance: false` omits it entirely, and the site still works.

```tsx
// Only if you want your own: the default entry is served for you.
import { enhancePage } from 'telamon/client';

enhancePage();
```

### Deploying

The handler is the whole integration. Everything else is whatever your runtime wants:

```ts
// Workers, Deno, Bun -- anything that speaks fetch
export default { fetch: handler };
```

```ts
// Node
import { createServer } from 'node:http';

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const response = await handler(new Request(url, { headers: new Headers(req.headers) }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(3000);
```

The page asks for two stylesheets and one script. Serve them yourself from `telamon/styles.css`, `telamon/tokens.css`, and `telamon/enhance.js`, or put them on a CDN and point `stylesheets` and `enhanceSrc` at it.

[`examples/deploy`](../../examples/deploy) is a working one: a server, a Dockerfile, and measured numbers for what it costs to run.

### Keeping a served bundle fresh

`handler.refresh()` re-reads the source and folds in what changed. It is the cheap way to stay current, because markdown parsing is what makes reading a bundle expensive and it is entirely per-document: a file nobody touched parses to what it parsed to before, so it is reused.

```ts
// Poll, or call it from a webhook your publishing pipeline fires.
setInterval(() => {
  void handler.refresh().then((changed) => {
    if (changed > 0) console.log(`refreshed: ${changed} files`);
  });
}, 10_000);
```

On a bundle of 2000 documents, against a 2.7 s full parse:

| files changed | refresh |
| --- | --- |
| 1 | 73 ms |
| 10 | 97 ms |
| 100 | 218 ms |
| none | 70 ms |

The floor is about 70 ms, and it earns its keep: every document's links are re-resolved against the new set of paths, because adding a file un-breaks the links that pointed at it and removing one breaks them. That is a walk of syntax trees that already exist, with no markdown parsing. Only files whose contents actually differ are re-parsed, so a source that cannot say what changed can hand over everything and still pay only for what did.

The updated bundle is a new object and the previous one is left untouched, so a request rendering from the old bundle finishes against a consistent view. When the concept graph is unchanged the previous graph object is carried over — which matters more than it sounds, because the settled force layout is cached against that object's identity and re-settling it would cost more than the whole refresh.

`refresh()` resolves to the number of files it took in, and rejects if the source read failed, leaving the bundle you already had in place and still being served.

#### Asking only for what changed

Everything above makes the *parse* cheap. The read can be made cheap too, for a source that can answer "what changed since". `fileSource` always can — it walks the tree either way, so it reads only files written since it last looked, and sees deletions for free. A database can when every mapping declares a `changedColumn`:

```json
{
  "table": "analytics.metric_definitions",
  "path": "metrics/{metric_name}.md",
  "changedColumn": "updated_at",
  "where": "is_published"
}
```

```ts
// `?` by default; Postgres wants $1.
databaseSource(config, query, { placeholder: (i) => `$${i}` });
```

`refresh()` then uses it automatically. **Two limits to read before you rely on it**, both of which come from what a "changed since" query can and cannot see:

- **A database source reports no deletions.** A query for what changed cannot return a row that is gone, and a row that stopped matching `where` — a metric that was unpublished — looks exactly like one nobody touched.
- **It leaves the synthesized `index.md` files alone.** Those are built from every row in a directory, so rebuilding them from a handful of changed rows would replace a good listing with a listing of one. A renamed document keeps its old label in its directory's listing until a full read — stale rather than wrong.

So pair it with a slower reconciling cycle:

```ts
setInterval(() => void handler.refresh(), 10_000);              // edits, cheaply
setInterval(() => void handler.refresh({ full: true }), 300_000); // deletions and indexes
```

`fileSource` has neither limit: it sees deletions, and a bundle's index files are real files it reads like any other.

One caveat that is the source's to own rather than telamon's: a cursor is the furthest-forward value seen in the rows returned, and a row committed with an earlier timestamp after that point will be missed until a full read. If your warehouse writes with a clock rather than a sequence, the reconciling cycle is what catches it.

### Updating a bundle yourself

The same machinery, without the server:

```ts
import { parseBundle, updateBundle, diffFiles } from 'telamon';

let bundle = parseBundle(await read());
// ... later
const files = await read();
bundle = updateBundle(bundle, diffFiles(bundle.files, files));
```

`updateBundle(previous, { changed, deleted })` produces exactly what `parseBundle` would have produced from the same files — the tests assert that document by document, including diagnostics, backlinks and the graph. `diffFiles(previous, current)` is for when you have a fresh read and no idea what moved.

### Handler options

| Option | Type | Notes |
| --- | --- | --- |
| `source` | `BundleSource` | Required. Where the bundle comes from. |
| `title` | `string` | Site title. Defaults to the bundle root's own. |
| `basename` | `string` | Sub-path the site is mounted at. URLs outside it are not answered for. |
| `features` | `OkfFeatures` | As `OkfSite`. |
| `searchRoute` | `string` | Where results are rendered. Defaults to `/search`. |
| `assetPrefix` | `string` | Where endpoints and scripts live. Defaults to `/_telamon`. |
| `enhance` | `boolean` | Send the enhancement script. Defaults to `true`. |
| `enhanceSrc` | `string` | URL of the enhancement script. Defaults to `{assetPrefix}/enhance.js`. |
| `stylesheets` | `string[]` | Head stylesheets. Defaults to the two library sheets. |
| `head` | `string` | Extra markup for `<head>` — a font, an analytics tag. |
| `isReference` | `(doc) => boolean` | What counts as provenance-only. |
| `noCache` | `boolean` | Re-read the source every request instead of caching it. |
| `onDiagnostics` | `({ source, bundle }) => void` | Everything the read and the parse reported. |

`handler.warm()` reads and parses up front, `handler.refresh()` folds in what changed, `handler.invalidate()` drops the cache, and `handler.close()` stops watching the source.

The bundle is read once and cached; concurrent first requests share a single read, a failed read is not cached, and a source that supports `watch` invalidates itself. `handler.invalidate()` throws the cache away, `handler.close()` stops watching.

That read is lazy — it happens on the first request. A long-lived server should `await handler.warm()` before it listens, so an unreadable bundle is a startup failure rather than a process that looks healthy and fails its first real request, and so the first visitor does not pay for the parse. On a large bundle that is seconds.

Status codes follow what `OkfRoutes` would render: a document, a directory, or the graph is a `200`, and only the not-found page is a `404`, so a crawler and a reader are told the same thing.

## Conformance and leniency

SPEC §11 forbids a consumer from rejecting a bundle over unknown types, unknown keys, missing optional fields, broken links, or a missing `index.md`. `telamon` follows that literally: **content problems never throw**. They become diagnostics, and the document still renders.

```tsx
<OkfSite bundle={bundle} onDiagnostics={(list) => console.warn(list)} />
```

Codes: `missing-type`, `invalid-frontmatter`, `frontmatter-on-reserved-file`, `broken-link`, `unresolved-index-entry`, `route-collision`, `unsupported-okf-version`, `broken-relationship`, `invalid-relationship`.

Unmodeled frontmatter keys are preserved verbatim on `doc.frontmatter.raw`. A bare `verified` mapping is normalized to a one-element list. `status` defaults to `stable`. A broken link renders inert and marked rather than as a link to nowhere.

`parseBundle` throws only for a malformed `files` argument — a programming mistake, not a content one.

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `bundle` | `Bundle \| Record<string, string>` | Parsed, or a raw path → contents map. |
| `title` | `string` | Header title. Defaults to the bundle root's title. |
| `basename` | `string` | Sub-path the site is mounted at. Ignored when `router` is set. |
| `router` | `RouterAdapter` | Defer URL ownership to a host router. |
| `components` | `Partial<OkfSlots>` | Region overrides. |
| `markdownComponents` | `MarkdownComponents` | Element-level overrides. |
| `classNames` | `Partial<Record<OkfSlotName, string>>` | Merged with the default `okf-*` classes. |
| `features` | `OkfFeatures` | Toggle search, graph, backlinks, TOC, references toggle. |
| `highlightCode` | `(code, language) => ReactNode` | See below. |
| `resolveAssetUrl` | `(bundlePath) => string` | Maps non-markdown links and images to real URLs. |
| `typeColor` | `(type) => string \| undefined` | Graph node colour per concept type. |
| `graphRoute` | `string` | Defaults to `/graph`. |
| `now` | `Date` | Clock for staleness. Injectable for tests and demos. |
| `isReference` | `(doc) => boolean` | What counts as provenance-only. Defaults to anything under `references/`. |
| `defaultShowReferences` | `boolean` | Initial toggle state when uncontrolled. Defaults to `true`. |
| `showReferences` | `boolean` | Controlled toggle state. |
| `onShowReferencesChange` | `(next) => void` | Pairs with `showReferences`. |
| `allowHtml`, `remarkPlugins`, `rehypePlugins` | | Parse-time; see below. Memoize the arrays. |
| `onNavigate` | `(route) => void` | |
| `onDiagnostics` | `(diagnostics) => void` | |
| `renderNotFound` | `(route) => ReactNode` | Shorthand for the `NotFound` slot. |

## Recipes

### Syntax highlighting

No highlighter ships with the library — bundling one would dwarf the rest of it and contradict the bring-your-own-tokens premise. Plug one in:

```tsx
import { codeToHtml } from 'shiki';
// (pre-render or memoize; highlightCode is synchronous)
<OkfSite bundle={bundle} highlightCode={(code, lang) => <Highlighted code={code} lang={lang} />} />
```

### Raw HTML in bodies

Raw HTML is dropped by default. To render it, opt in *and* supply the plugins, which are yours to install so the HTML parser stays out of everyone else's bundle:

```tsx
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

const rehypePlugins = [rehypeRaw, rehypeSanitize]; // module scope: stable identity

<OkfSite bundle={bundle} allowHtml rehypePlugins={rehypePlugins} />;
```

### Mounting inside an existing router

A `RouterAdapter` is three functions. For react-router:

```tsx
import { useLocation, useNavigate, useHref } from 'react-router-dom';

function useReactRouterAdapter(): RouterAdapter {
  const navigate = useNavigate();
  return {
    usePath: () => useLocation().pathname,
    navigate: (route, options) => navigate(route, { replace: options?.replace }),
    createHref: (route) => route,
  };
}
```

Adapters speak in routes — basename-free and URL-decoded. When you supply one, it owns the basename.

### Server rendering

For rendering a bundle inside a server you already have. If you want telamon to *be* the server, see [Serving a bundle](#serving-a-bundle) instead.

`createMemoryRouter(initialRoute)` has no browser dependency, so it renders on the server:

```tsx
renderToString(<OkfSite bundle={bundle} router={createMemoryRouter(req.path)} />);
```

The History router works too, and is what you want if the page will hydrate: pass `serverRoute` so the server renders the route the browser is at, since React uses that same snapshot for the first render of a hydration.

```tsx
renderToString(
  <OkfSite bundle={bundle} router={createHistoryRouter({ serverRoute: req.path })} />,
);
```

### Building your own chrome

`OkfProvider` gives you the parsed bundle, routing, and hooks without the layout:

```tsx
<OkfProvider bundle={bundle}>
  <MyShell>
    <OkfRoutes />
  </MyShell>
</OkfProvider>
```

Hooks: `useOkfBundle`, `useOkfConfig`, `useDoc`, `useCurrentDoc`, `useNavTree`, `useBacklinks`, `useSearch`, `useReferences`, `useRoute`, `useNavigate`. `useNavTree` and `useSearch` already respect the references toggle, so custom chrome inherits it for free. Lower-level pieces — `parseBundle`, `classifyHref`, `filePathToRoute`, `buildSearchIndex`, `Markdown`, `ConceptPage` — are all exported too.

## Development

```bash
pnpm install
pnpm test          # vitest, against the real GA4 reference bundle plus edge-case fixtures
pnpm typecheck
pnpm build
pnpm dev           # the playground: two bundles, three token themes, live diagnostics

npx telamon serve ./bundle   # or skip all of it and just read a bundle
```

## License

MIT. The test fixture under `test/fixtures/ga4/` is a copy of the GA4 sample bundle from [GoogleCloudPlatform/open-knowledge-format](https://github.com/GoogleCloudPlatform/open-knowledge-format), Apache-2.0.
