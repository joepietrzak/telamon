import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // `appType: 'spa'` is the default and is the whole reason this works:
  // telamon routes on the pathname, so a reload on /tables/events_ has to be
  // answered with index.html rather than a 404. `vite preview` does that;
  // any static host serving this build needs the same rewrite.
  build: {
    // The bundle is compiled into the app, so the markdown lands in a chunk
    // rather than being fetched. Worth seeing in the output.
    reportCompressedSize: true,
  },
});
