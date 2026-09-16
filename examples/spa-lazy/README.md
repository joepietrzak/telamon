# A telamon SPA that does not ship the corpus

Same deployment as [`../spa`](../spa) — static files, no server, no database —
but the first load carries an index of the corpus instead of the corpus.

## The split

Everything that needs the *whole* bundle is built from frontmatter and links:
the navigation tree, the search index, the graph, backlinks. Only the body of
the document on screen needs a body. On a corpus of 2000 Wikipedia articles
that split is **5.4%** against **94.6%**.

So `vite-plugin-okf-manifest.ts` emits the frontmatter half as a virtual module
that is inlined eagerly, and the bodies stay behind `import.meta.glob` *without*
`eager`, which makes each document its own hashed chunk. `src/main.tsx` parses
the manifest, and on every navigation fetches that one body and folds it in
with `updateBundle`, which re-parses the one document rather than the corpus.

Reserved files travel whole: an `index.md` is a list of links, which is what
the tree is built from.

## Measured

2009 documents, 33 MB of markdown, against the eager build in `../spa`:

| | eager | lazy | |
| --- | --- | --- | --- |
| entry JS | 44.6 MB | **3.0 MB** | 15× smaller |
| over the wire (gz) | 14.0 MB | **0.69 MB** | 20× smaller |
| `vite build` | 155s | **14s** | 11× faster |
| first render, loopback | 31.5s | **3.5s** | 9× faster |
| first load @ 25 Mbps | ~36s | **~3.7s** | |
| navigation to an unread document | free | ~160ms + a ~16 KB chunk | |
| artifact on disk | 44.7 MB | 52 MB | 2011 extra chunks |

`parseBundle` over the manifest is 2.3s of that 3.5s; over the full corpus it
is 29.6s. The remaining ~160ms per navigation is `updateBundle`, and it does
not grow as you read: it is the same cost on the first document and the
hundredth.

## What it costs you

- **A navigation to an unread document is no longer free.** ~160ms of it is
  `updateBundle` recomputing what depends on the whole bundle — resolution,
  tree, backlinks, graph — which is O(corpus) even though the parse is O(1).
  At 2000 documents that is the number above; it will be larger on a larger
  corpus.
- **Search results and graph labels are available before bodies are.** They are
  built from frontmatter, so they are complete from the first paint. Full-text
  search over bodies is not, and would need either the eager build or an index
  emitted at build time.
- **2011 files instead of 3.** Fine for any static host; worth knowing if
  something in your pipeline counts files.

## When to use which

Ship the corpus (`../spa`) when it is small — under roughly 10 MB of markdown,
where first load stays near a second and every navigation is free. Ship the
index (this one) when it is not, and you still want a directory of static files
rather than a process.
