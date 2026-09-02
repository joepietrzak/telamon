# telamon

A TypeScript library that renders a [Google Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format) (OKF) bundle as a React single-page app — routing derived from the bundle's directory structure, pages rendered from the markdown, and OKF frontmatter surfaced as page chrome.

Bring your own design tokens; every visual value is a `--okf-*` custom property.

- **[`packages/telamon`](./packages/telamon)** — the library. See its [README](./packages/telamon/README.md) for the API.
- **[`examples/playground`](./examples/playground)** — a Vite demo with two bundles, three token themes, and live diagnostics.

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm dev      # playground at http://localhost:5173
```

MIT.
