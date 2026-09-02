# telamon

A TypeScript library that renders a [Google Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format) (OKF) bundle as a React single-page app — routing derived from the bundle's directory structure, pages rendered from the markdown, and OKF frontmatter surfaced as page chrome.

Bring your own design tokens; every visual value is a `--okf-*` custom property.

- **[`packages/telamon`](./packages/telamon)** — the library. Start with the [getting-started guide](./packages/telamon/docs/getting-started.md); the [README](./packages/telamon/README.md) is the API reference.
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
