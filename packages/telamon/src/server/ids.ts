/**
 * Names shared by the server and the browser.
 *
 * Their own module so the enhancement script can read them without importing
 * the handler, which would drag `react-dom/server` into the browser bundle.
 */

/** Where the endpoints and scripts live. */
export const ASSET_PREFIX = '/_telamon';
/** Element holding the settings the enhancement script reads. */
export const ENHANCE_SCRIPT_ID = 'okf-settings';
/** Element the site is rendered into. */
export const ROOT_ELEMENT_ID = 'okf-root';

/**
 * What the server tells the enhancement script.
 *
 * Settings, not content: a served page carries no bundle, and the script asks
 * the server for what it needs. This stays a few dozen bytes however large the
 * bundle is.
 */
export interface EnhancePayload {
  /** Route the search form submits to. */
  searchRoute: string;
  /** Prefix the endpoints live under. */
  assetPrefix: string;
  /** Sub-path the site is mounted at, for building result hrefs. */
  basename?: string;
}
