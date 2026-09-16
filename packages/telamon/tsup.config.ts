import { defineConfig } from 'tsup';

const external = ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/server', 'react-dom/client'];

export default defineConfig([
  {
    // The library: every entry a consumer imports by name.
    entry: [
      'src/index.ts',
      'src/client.ts',
      'src/db/index.ts',
      'src/source/index.ts',
      'src/server/index.ts',
      // The Vite plugin. Node-only, and never reached by a browser build --
      // it reads the bundle off disk at build time.
      'src/vite/index.ts',
    ],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    splitting: true,
    external,
  },
  {
    // The CLI: ESM only, and executable.
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    sourcemap: true,
    treeshake: true,
    external,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    // The prebuilt enhancement script the CLI serves. Named `enhance` rather
    // than `client` because dist/client.js is already the ESM module behind the
    // `telamon/client` export, and this is the script tag's payload.
    //
    // No React here: it enhances rendered HTML rather than rendering anything,
    // which is what keeps it kilobytes instead of hundreds of them.
    entry: { enhance: 'src/server/enhance-auto.ts' },
    format: ['iife'],
    platform: 'browser',
    sourcemap: true,
    minify: true,
    treeshake: true,
    noExternal: [/.*/],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
]);
