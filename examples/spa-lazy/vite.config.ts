import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { okfBudget, okfManifest } from 'telamon/vite';
import { fileURLToPath } from 'node:url';
import { metricsApi } from './api';

// `OKF_BUNDLE=corpus pnpm dev` swaps in another bundle without touching this
// file; the Dockerfile takes the same name as a build arg.
const dir = fileURLToPath(new URL(process.env.OKF_BUNDLE ?? './bundle', import.meta.url));

export default defineConfig({
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
