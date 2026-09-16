import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { okfBudget, okfManifest } from 'telamon/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    // Emits `virtual:okf-manifest`: every document's frontmatter inlined, and
    // a dynamic import per body so each one becomes its own chunk.
    okfManifest({ dir: fileURLToPath(new URL('./bundle', import.meta.url)) }),
    // And a guard against the split quietly coming undone. Inline the corpus
    // instead and this build fails here rather than on someone's phone.
    okfBudget({ max: '1 MB' }),
  ],
});
