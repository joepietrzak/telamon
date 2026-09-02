import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const lib = (p: string) => fileURLToPath(new URL(`../../packages/telamon/${p}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Consume the library's TypeScript source directly so the playground
    // hot-reloads on library edits without a rebuild step.
    alias: [
      { find: /^telamon\/tokens\.css$/, replacement: lib('src/styles/tokens.css') },
      { find: /^telamon\/styles\.css$/, replacement: lib('src/styles/base.css') },
      { find: /^telamon$/, replacement: lib('src/index.ts') },
    ],
  },
  server: {
    fs: { allow: [workspaceRoot] },
  },
});
