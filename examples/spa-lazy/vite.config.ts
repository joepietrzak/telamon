import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { okfBudget, okfManifest } from 'telamon/vite';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { metricsApi } from './api';

const here = dirname(fileURLToPath(import.meta.url));
const sample = resolve(here, 'bundle');
// `OKF_BUNDLE=corpus pnpm dev` swaps in another bundle without touching this
// file; the Dockerfile takes the same name as a build arg.
const dir = resolve(here, process.env.OKF_BUNDLE ?? 'bundle');

/**
 * What the header and the tab call the site. A bundle goes by the heading of
 * its root index, which is how telamon titles it too. The GA4 sample's is
 * "Subdirectories", as OKF root indexes tend to be, so that one is named here.
 */
function siteTitle(): string {
  if (dir === sample) return 'GA4 analytics reference';
  try {
    const index = readFileSync(join(dir, 'index.md'), 'utf8');
    return /^#\s+(.+)$/m.exec(index)?.[1].trim() ?? 'Knowledge bundle';
  } catch {
    return 'Knowledge bundle';
  }
}

export default defineConfig({
  // Read by main.tsx, and by index.html as `%SITE_TITLE%`.
  define: { 'import.meta.env.SITE_TITLE': JSON.stringify(siteTitle()) },
  plugins: [
    react(),
    // Emits `virtual:okf-manifest`: every document's frontmatter inlined, and
    // a dynamic import per body so each one becomes its own chunk.
    okfManifest({ dir }),
    // And a guard against the split quietly coming undone. Inline the corpus
    // instead and this build fails here rather than on someone's phone.
    okfBudget({ max: '1 MB' }),
    // `GET /api/metrics`, served by `vite` and `vite preview` alike.
    metricsApi({ dir }),
  ],
});
