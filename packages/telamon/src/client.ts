/**
 * `telamon/client` -- the browser half of a served bundle.
 *
 * Progressive enhancement, not hydration: the page arrives rendered and already
 * working, and this upgrades it. Separate from `telamon/server` so importing it
 * never pulls `react-dom/server` into a browser build -- and it pulls no React
 * at all.
 */
export { enhancePage } from './server/enhance.js';
export { ENHANCE_SCRIPT_ID, ROOT_ELEMENT_ID, type EnhancePayload } from './server/ids.js';
