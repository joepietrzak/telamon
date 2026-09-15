# telamon

A TypeScript library that renders a [Google Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format) (OKF) bundle as a website — routing derived from the bundle's directory structure, pages rendered from the markdown, and OKF frontmatter surfaced as page chrome. Build it into a React app, or let telamon serve it from a directory or a database.

Bring your own design tokens; every visual value is a `--okf-*` custom property.

- **[`packages/telamon`](./packages/telamon)** — the library. Start with the [getting-started guide](./packages/telamon/docs/getting-started.md); the [README](./packages/telamon/README.md) is the API reference.
- **[`examples/playground`](./examples/playground)** — a Vite demo with two bundles, three token themes, and live diagnostics.
- **[`examples/db-sync`](./examples/db-sync)** — a seeded SQLite warehouse synced into a bundle, mapping and all.
- **[`examples/deploy`](./examples/deploy)** — a deployable server: one file, a Dockerfile, and what it costs to run.

Look at a bundle without building anything:

```bash
npx telamon serve ./bundle
```

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm dev      # playground at http://localhost:5173
```

MIT.
