# Embedding telamon in another site

Two containers on two origins:

- **`docs`**: [`../spa-lazy`](../spa-lazy) on `:3000`, which is the telamon site
  plus a small JSON API, `GET /api/metrics`, served by the same Vite.
- **`site`**: this directory on `:8080`, which is nginx and three static files.
  The page embeds the docs in an iframe and draws a table from the API.

```bash
docker compose up --build                       # the 14-document GA4 bundle
OKF_BUNDLE=corpus docker compose up --build     # the 2000-document Wikipedia sample
# → http://localhost:8080
```

The second line needs `../spa-lazy/corpus/`. It is not in the repository
(44 MB of CC BY-SA text), and any OKF bundle directory works in its place.

## Why an iframe

The docs are a whole application. telamon routes on the pathname, brings its own
stylesheet and its own React, and splits the corpus into two thousand chunks it
fetches as you read. An iframe gives all of that its own window, so none of it
has to coexist with the host page:

- the URL inside the frame is the docs' own, so their routing works unchanged
- their CSS cannot reach the host and the host's cannot reach them
- the host needs no build step, no React, and no idea how telamon works
- either side deploys without the other

The newer alternative is to load the docs' JavaScript into the host page, as a
web component or through module federation. That is the better choice when the
docs have to look native to the host or share state with it. The cost is that
both apps then share one URL bar, one cascade (unless you add shadow DOM) and
possibly two copies of React, and every chunk has to be served with CORS to a
page on another origin. That is a lot of coupling to buy for a pane of
documentation.

An iframe costs you three things:

- **The frame scrolls on its own.** Here that is what you want, since the docs
  fill the pane beside the table. For content that should flow with the page,
  the frame has to post its height to the host.
- **The host URL does not follow navigation inside the frame.** A reload goes
  back to the docs' home page. If that matters, the docs can `postMessage` each
  route to `window.parent` (telamon's `onNavigate` already reports them) and the
  host keeps it in its hash.
- **A link without a target navigates the frame.** An external page would
  replace the docs inside the pane, and many sites refuse to be framed at all.
  Every document here links out to Wikipedia. telamon opens external links with
  `target="_blank"`, so they open in a new tab instead.

## What each side had to do

**The docs site** sends `Access-Control-Allow-Origin: *` on `/api/metrics`.
Without it the browser would let the page make the request but would not let it
read the response. The iframe needed nothing. To limit which sites may embed the
docs, send `Content-Security-Policy: frame-ancestors http://localhost:8080` via
`preview.headers` in `vite.config.ts`. Vite applies those headers to the SPA
fallback too.

**This site** needs to know where the docs are _as the reader's browser reaches
them_. That is `http://localhost:3000`, not `http://docs:3000`: the compose
service name resolves only inside the Docker network, and the iframe and the
fetch both run on the reader's machine. `DOCS_URL` is read when the container
starts, and nginx answers `/config.js` with it (see `default.conf.template`), so
one image serves any environment.

## The page

`main.js` is the whole consumer:

```js
import { DOCS_URL } from './config.js';

const api = new URL('/api/metrics', DOCS_URL);
$('#docs').src = DOCS_URL;

const response = await fetch(api);
render(await response.json());
```

Directory names that are language codes get their name from
`Intl.DisplayNames`, so `ar/` reads as Arabic. The API does not know about
languages and does not need to.
