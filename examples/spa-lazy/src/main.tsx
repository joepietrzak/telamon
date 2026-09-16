/// <reference types="telamon/vite-client" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OkfSite, useLazyBundle } from 'telamon';
import 'telamon/tokens.css';
import 'telamon/styles.css';
import { BODIES, MANIFEST } from 'virtual:okf-manifest';

function LazySite() {
  // The first bundle is the whole corpus minus its prose: every route, title,
  // type, tag and link, and no bodies. Enough to draw the navigation, answer a
  // search, and lay out the graph. Each navigation then fetches one body.
  const { bundle, onNavigate } = useLazyBundle({ manifest: MANIFEST, bodies: BODIES });
  return <OkfSite bundle={bundle} title="GA4 analytics reference" onNavigate={onNavigate} />;
}

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root');
createRoot(root).render(
  <StrictMode>
    <LazySite />
  </StrictMode>,
);
