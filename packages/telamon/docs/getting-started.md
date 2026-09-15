# Getting started

Take an OKF bundle you have on disk and turn it into a running site, then work outwards through the props you'll actually reach for.

The [README](../README.md) is the reference — every prop, every export. This is the walkthrough.

---

## The whole thing, at a glance

```tsx
import { OkfSite } from 'telamon';
import 'telamon/tokens.css';
import 'telamon/styles.css';

const bundle = {
  'index.md': '# Subdirectories\n\n* [tables](tables/index.md) - Our tables.\n',
  'tables/index.md': '# Tables\n\n* [Events](events_.md) - Event export.\n',
  'tables/events_.md': '---\ntype: BigQuery Table\ntitle: Events\n---\n\nOne row per event.\n',
};

export function App() {
  return <OkfSite bundle={bundle} title="Our knowledge bundle" />;
}
```

That renders a complete site: sidebar, routing at `/tables/events_`, breadcrumbs, search, backlinks, a concept graph. Everything below is refinement.

---

## Step 1 — Get the bundle into memory

`telamon` never fetches anything. It takes `Record<string, string>` — bundle-relative path to file contents — and loading is your app's decision. This is the step people get wrong, so here are four working loaders.

**Keys must be bundle-relative.** `tables/events_.md`, not `./bundle/tables/events_.md` and not `/abs/path/tables/events_.md`. The routing and every cross-link resolve against those keys.

### Build-time, with Vite

The bundle compiles into your app. No network, no loading state.

```ts
const modules = import.meta.glob('./bundle/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const bundle = Object.fromEntries(
  Object.entries(modules).map(([path, text]) => [path.replace('./bundle/', ''), text]),
);
```

### From a directory, on the server

If the bundle is a directory on the machine doing the rendering, `fileSource` reads it:

```ts
import { fileSource } from 'telamon/source';

const { files, diagnostics } = await fileSource('./bundle').load();
```

It reads markdown, skips dotfiles and `node_modules`, takes `ignore` globs and a size ceiling, refuses to loop on a symlinked directory, and reports every file it declined to read rather than leaving a silent hole. If you only want to look at a bundle rather than build a site around it, skip straight to [step 6](#step-6--or-let-telamon-serve-it).

### From a database, on the server

If the knowledge already lives in a warehouse, a JSON file says which tables become which files and `telamon/db` does the rest. It never opens a connection — you pass a query function, so credentials, pooling, and dialect stay yours.

```ts
// okf.db.json
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
      "frontmatter": { "description": "summary", "tags": "tags" },
      "directory": { "title": "Metrics", "description": "Agreed definitions." },
      "where": "is_published"
    }
  ]
}
```

```ts
// a loader, a server component, or a build script
import { loadBundle } from 'telamon/db';

const { files, diagnostics } = await loadBundle(config, (sql, params) =>
  pool.query(sql, params),
);
// -> <OkfSite bundle={files} />
```

`files` is the same path → contents map as any other route into the library, so nothing downstream knows the difference. Run it per request for always-fresh pages, or once at build time and write the result out as a checked-in bundle. Full mapping reference in the [README](../README.md#reading-a-bundle-out-of-a-database).

### Runtime, over HTTP

Content updates without a rebuild, at the cost of a loading state. You need a listing of what to fetch — generate a `manifest.json` when you publish the bundle.

```tsx
function useRemoteBundle(baseUrl: string) {
  const [bundle, setBundle] = useState<Record<string, string>>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const paths: string[] = await fetch(`${baseUrl}/manifest.json`).then((r) => r.json());
      const texts = await Promise.all(
        paths.map((p) => fetch(`${baseUrl}/${p}`).then((r) => r.text())),
      );
      if (!cancelled) setBundle(Object.fromEntries(paths.map((p, i) => [p, texts[i]!])));
    })();
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  return bundle;
}
```

> **Give the map a stable identity.** `<OkfSite bundle={{ 'a.md': '…' }} />` builds a new object every render, and every new object re-parses the whole bundle. Define it at module scope, or `useMemo` it.

---

## Step 2 — Render it

```tsx
import { OkfSite } from 'telamon';
import 'telamon/tokens.css'; // optional — the default look
import 'telamon/styles.css'; // required — structure, entirely token-driven
import { bundle } from './bundle';

export function App() {
  return <OkfSite bundle={bundle} title="Our knowledge bundle" />;
}
```

Both stylesheets are plain CSS with no build step. `styles.css` is not optional — without it you get correct, entirely unstyled markup. `tokens.css` is: skip it once you're supplying your own tokens (Step 4).

The site fills its container and its sidebar sticks on scroll, so give its ancestors a height:

```css
html, body, #root { height: 100%; }
body { margin: 0; }
```

---

## Step 3 — Host the built app

This step is for the app you just built. If you would rather telamon did the serving, skip to [step 6](#step-6--or-let-telamon-serve-it).

The default router uses real URLs, so `/tables/events_` must return your `index.html` rather than a 404. Vite's dev server already does this. For production:

```nginx
# nginx
location / { try_files $uri $uri/ /index.html; }
```

```js
// express
app.use(express.static('dist'));
app.get('*', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
```

Netlify `_redirects`: `/*  /index.html  200`. Vercel: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`.

Mounting under a sub-path? Tell the router where it lives:

```tsx
<OkfSite bundle={bundle} basename="/docs" />
```

---

## Step 4 — Make it look like yours

Three levels, in the order you should reach for them.

### Tokens (start here)

`styles.css` never hardcodes a value. Every declaration reads a `--okf-*` custom property, so restyling the whole site is CSS variables — no component overrides, nothing to keep in sync.

```css
/* your own stylesheet, loaded after telamon's */
:root {
  --okf-font-sans: 'Söhne', system-ui, sans-serif;
  --okf-color-accent: #8a3324;
  --okf-color-bg: #fbf7ef;
  --okf-color-fg: #241f18;
  --okf-radius-md: 0;
  --okf-content-max: 42rem;
  --okf-sidebar-width: 15rem;
}
```

That is a complete reskin. Tokens cover type, space, shape, layout, colour, and the graph palette — the full set is [`src/styles/tokens.css`](../src/styles/tokens.css), which doubles as the list of what you can override.

Dark mode comes from `tokens.css` under `prefers-color-scheme`, and you can force either way with `data-okf-theme="dark"` / `"light"` on the root element.

Once you own the whole set, drop the `tokens.css` import and keep only `styles.css`.

### `classNames` (for utility-class frameworks)

Each entry is *merged with* the default `okf-*` class, not swapped for it:

```tsx
<OkfSite bundle={bundle} classNames={{ main: 'prose lg:prose-lg', sidebar: 'text-sm' }} />
```

Named regions: `root`, `header`, `headerTitle`, `download`, `sidebar`, `nav`, `navLink`, `body`, `main`, `article`, `breadcrumbs`, `conceptHeader`, `metaRow`, `toc`, `backlinks`, `relationships`, `sources`, `search`, `searchResults`, `referencesToggle`, `graph`, `footer`.

### Slots (when the markup itself has to change)

```tsx
// Module scope, not inline — a new function identity each render remounts the region.
const slots = {
  Header: ({ title }) => <MyHeader>{title}</MyHeader>,
  Footer: () => <MyFooter />,
};

<OkfSite bundle={bundle} components={slots} markdownComponents={{ blockquote: Callout }} />;
```

Regions: `Header`, `Sidebar`, `Breadcrumbs`, `ConceptHeader`, `SourcesList`, `Relationships`, `Toc`, `Backlinks`, `SearchBox`, `Graph`, `ReferencesToggle`, `Download`, `NotFound`, `Footer`. `markdownComponents` reaches individual rendered elements (`h2`, `table`, `code`, …).

---

## Step 5 — The props you'll actually reach for

### Turning features off

```tsx
<OkfSite
  bundle={bundle}
  features={{ search: true, graph: false, backlinks: true, toc: true, referenceToggle: true, download: true }}
/>
```

All default to `true`. Turning `graph` off also means its chunk is never requested.

### Handing back the source

The header carries a Download control that hands back every file in the bundle as a ZIP named after the site title. In an app it is a button: the bundle is already in memory, so the archive is built on click and costs nothing until someone asks for it. On a served site it is a link to a zip the server builds, which means it works with JavaScript off. Turn it off with `features={{ download: false }}`, or build your own from `zipFiles(bundle.files)`.

### Hiding provenance-only concepts

If your bundle has concepts that exist only to carry source provenance, the references toggle hides them from the sidebar and search while leaving them routable and linkable:

```tsx
<OkfSite bundle={bundle} defaultShowReferences={false} />
```

By default a concept counts as a reference if it lives under a `references/` directory at any depth. Match on something else if your bundles differ:

```tsx
<OkfSite bundle={bundle} isReference={(doc) => doc.frontmatter.type === 'Reference'} />
```

Persist the reader's choice by taking control of it:

```tsx
const [show, setShow] = useState(() => localStorage.getItem('refs') !== 'off');

<OkfSite
  bundle={bundle}
  showReferences={show}
  onShowReferencesChange={(next) => {
    setShow(next);
    localStorage.setItem('refs', next ? 'on' : 'off');
  }}
/>;
```

### Saying how concepts relate

OKF cross-links are untyped, so the graph can only show that two concepts are connected. To say *how*, add a `relationships` block to a concept's frontmatter:

```yaml
relationships:
  - type: depends_on
    target: /tables/events_.md
    description: Reads the raw event stream.
```

Targets use the same forms as any OKF link. Each entry becomes a labelled, arrow-headed edge in the graph, a row in the page's Relationships section, and a backlink on the target — no configuration needed. Unresolvable targets report as `broken-relationship` diagnostics rather than breaking the page.

### Syntax highlighting

No highlighter ships — bundling one would dwarf the library. OKF bodies are full of SQL, so you probably want one:

```tsx
<OkfSite bundle={bundle} highlightCode={(code, language) => <Highlighted code={code} lang={language} />} />
```

`highlightCode` is synchronous, so pre-render or memoize if your highlighter is async.

### Images and other assets

Non-markdown links and images resolve to bundle-relative paths; you map them to real URLs:

```tsx
<OkfSite bundle={bundle} resolveAssetUrl={(path) => `https://cdn.example.com/bundle/${path}`} />
```

### Watching for content problems

```tsx
<OkfSite bundle={bundle} onDiagnostics={(list) => list.forEach((d) => console.warn(d.code, d.filePath, d.message))} />
```

Content problems never throw — a broken link, a concept missing `type`, a route collision. The page still renders, and this is how you hear about it. See [Checking a bundle in CI](#checking-a-bundle-in-ci).

### Everything else

`onNavigate` for analytics, `graphRoute` to move the graph off `/graph`, `typeColor` to colour graph nodes by concept type, `now` to pin the clock that decides `stale_after` staleness, `renderNotFound` for your own 404. Full table in the [README](../README.md#props).

---

## Step 6 — Or let telamon serve it

Everything above builds a site you compile and host. The other way round is to let telamon do the rendering.

### Locally

```bash
npx telamon serve ./bundle
```

No build, no config, no `package.json`. It reads the directory, serves it at `http://localhost:3000`, and picks up edits as you save. `--port`, `--host`, `--basename`, and `--title` are there when you need them.

### Deployed

The CLI is a thin wrapper over a handler you can deploy yourself:

```ts
import { fileSource } from 'telamon/source';
import { createBundleHandler } from 'telamon/server';

const handler = createBundleHandler({
  source: fileSource('./bundle'),
  title: 'Acme analytics',
});

export default { fetch: handler };
```

It takes web standard `Request` and `Response`, so it runs anywhere that speaks fetch. Swap `fileSource` for `databaseSource` and the same server reads a warehouse instead — the handler never learns which it got.

### What the visitor gets

The rendered page and nothing else. No bundle travels to the browser, so a page weighs what the page weighs: make every document in a bundle a thousand times longer and a served page grows by one document, the one it renders.

The three features that want the whole corpus are answered by the server — search is a form submitting to `/search`, the source download is a link to a zip the server builds, and the graph is drawn before the page is sent, nodes and all, each one a link you can click. All of which means the site works with JavaScript switched off entirely. A small script then upgrades it in place: the narrow-screen nav button, `/` and ⌘K, search results as you type, and drag-to-pan and scroll-to-zoom on the graph. It is under 3 KB over the wire and carries no React, no d3 and no bundle. `--no-script` leaves it out and loses no function.

Full option table in the [README](../README.md#serving-a-bundle).

---

## Mounting inside an app you already have

### Your own router owns the URL

A `RouterAdapter` is three functions. Adapters speak in **routes** — basename-free, URL-decoded. When you pass one, `basename` is yours to handle.

```tsx
import { useLocation, useNavigate } from 'react-router-dom';

function useAdapter(): RouterAdapter {
  const navigate = useNavigate();
  return {
    usePath: () => useLocation().pathname,
    navigate: (route, options) => navigate(route, { replace: options?.replace }),
    createHref: (route) => route,
  };
}

<OkfSite bundle={bundle} router={useAdapter()} />;
```

### Your own layout

`OkfProvider` gives you the parsed bundle, routing, and hooks without any chrome:

```tsx
<OkfProvider bundle={bundle}>
  <MyShell sidebar={<MySidebar />}>
    <OkfRoutes />
  </MyShell>
</OkfProvider>
```

Build the sidebar from `useNavTree()`, search with `useSearch(query)`, read the current page with `useDoc()`. Both `useNavTree` and `useSearch` already respect the references toggle, so custom chrome inherits it.

### Server rendering

Nothing touches `window` during render:

```tsx
renderToString(<OkfSite bundle={bundle} router={createMemoryRouter(req.path)} />);
```

---

## Checking a bundle in CI

`parseBundle` is the whole pipeline without React — useful as a test that the bundle you're authoring stays clean:

```ts
import { parseBundle } from 'telamon';
import { fileSource } from 'telamon/source';

const { files, diagnostics: read } = await fileSource('./bundle').load();
const bundle = parseBundle(files);

// Two layers, and both matter: what could not be read, and what does not parse.
const problems = [...read, ...bundle.diagnostics].filter((d) => d.severity === 'warning');

if (problems.length > 0) {
  for (const d of problems) console.error(`${d.filePath ?? ''}: [${d.code}] ${d.message}`);
  process.exit(1);
}
```

Parse codes: `missing-type`, `invalid-frontmatter`, `frontmatter-on-reserved-file`, `broken-link`, `unresolved-index-entry`, `route-collision`, `unsupported-okf-version`, `broken-relationship`, `invalid-relationship`.

Read codes, from `fileSource`: `unreadable-directory`, `unreadable-file`, `file-too-large`, `broken-symlink`, `empty-source`. A database source reports its own — see the [README](../README.md#what-it-does-with-the-rows).

---

## When something looks wrong

| Symptom | Cause |
| --- | --- |
| Correct content, no styling at all | `telamon/styles.css` was never imported. |
| Deep links 404 on reload | The server needs a history fallback (Step 3). |
| Sidebar shows one flat list, or nothing nests | Bundle keys aren't bundle-relative — a `./bundle/` prefix is still on them. |
| Cross-links render struck through | The target file isn't in the map. Check `onDiagnostics` for `broken-link`. |
| Site feels slow, re-renders heavily | The `bundle` prop is a new object each render, re-parsing every time. Hoist or memoize it. |
| A custom slot loses its state | It's defined inline in render. Move it to module scope. |
| Code blocks are unstyled | No `highlightCode` — none ships by default. |
| A page you expect is missing from the nav | It may be a reference concept and the toggle is off. |
| A `relationships` entry does not appear | Check `onDiagnostics` for `broken-relationship` (target not in the bundle) or `invalid-relationship` (entry is not a mapping, or has no `target`). |
| `remarkPlugins` / `rehypePlugins` seem to re-parse constantly | Those arrays need a stable identity too. |
