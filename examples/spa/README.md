# A telamon SPA

The whole corpus compiled into the app, served as static files. No server knows
what an OKF document is.

```bash
pnpm install
pnpm --filter telamon-spa dev        # http://localhost:5173
pnpm --filter telamon-spa build      # dist/
```

## How the bundle gets in

`telamon` takes a `Record<path, contents>` and has no opinion about where it
came from, so loading is the app's choice. Here it is one call:

```ts
const modules = import.meta.glob('../bundle/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
```

Vite reads every markdown file at build time and inlines it, so the markdown
directory does not exist in the artifact that ships — it is inside the
JavaScript. `src/bundle.ts` strips the glob prefix so the keys are
bundle-relative, which is what OKF paths are, and `src/main.tsx` hands the
result to `<OkfSite bundle={BUNDLE} />`.

## What it costs

Measured on the 14-document GA4 bundle in `bundle/`:

| asset | size |
| --- | --- |
| `index.html` | 406 B |
| `index-*.js` (React, telamon, and the whole corpus) | 477 KB |
| `index-*.css` | 22 KB |
| `GraphView-*.js` (lazy, fetched only on `/graph`) | 20 KB |

Every visitor downloads the entire corpus before the first document renders,
and the number grows with the corpus rather than with the page. That is the
trade: in exchange there is no process to run, no database to reach, and
navigation after the first paint costs nothing at all because everything is
already local.

It is the right shape for a corpus you can hold in memory and a deployment you
would rather be a directory than a server. It stops being the right shape at
roughly the point where you notice the first load.

## Routing

telamon routes on the pathname, so `/tables/events_` is a real URL that can be
linked, bookmarked and reloaded. A host has to answer those paths with
`index.html` rather than a 404:

- `vite preview` — what the container runs, and the default for `appType: 'spa'`
- nginx — `try_files $uri /index.html;`
- S3 + CloudFront — map the 404 error document to `/index.html`
- GitHub Pages — copy `index.html` to `404.html`

## Container

```bash
docker build -t telamon-spa .
docker run --rm -p 3000:3000 telamon-spa
```

Multi-stage: Vite builds, and the runtime stage carries the build output. It
serves with `vite preview`, which is honest about what this is — a static
artifact behind an SPA fallback. Any static host with the rewrite above serves
the same `dist/` without Node at all.
