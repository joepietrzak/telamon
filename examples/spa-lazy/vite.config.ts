import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { okfManifest } from './vite-plugin-okf-manifest.js';

const bundleDir = fileURLToPath(new URL('./bundle', import.meta.url));

export default defineConfig({
  plugins: [react(), okfManifest(bundleDir)],
});
