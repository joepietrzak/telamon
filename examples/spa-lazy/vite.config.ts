import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { okfManifest } from 'telamon/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    // Emits `virtual:okf-manifest`: every document's frontmatter inlined, and
    // a dynamic import per body so each one becomes its own chunk.
    okfManifest({ dir: fileURLToPath(new URL('./bundle', import.meta.url)) }),
  ],
});
