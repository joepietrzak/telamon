import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OkfSite } from 'telamon';
import 'telamon/tokens.css';
import 'telamon/styles.css';
import { BUNDLE } from './bundle.js';

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root');

// No router prop: telamon's default adapter drives the History API, so routes
// are real URLs that can be linked, bookmarked and reloaded.
createRoot(root).render(
  <StrictMode>
    <OkfSite bundle={BUNDLE} title="GA4 analytics reference" />
  </StrictMode>,
);
