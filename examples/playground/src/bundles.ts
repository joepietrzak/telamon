/**
 * Load the bundles at build time.
 *
 * `telamon` takes an in-memory `Record<path, contents>` and stays out of the
 * business of fetching files, so the loading strategy is the app's choice.
 * Here that is Vite's `import.meta.glob`, which compiles the markdown straight
 * into the app; a different app could just as well fetch the same shape over
 * HTTP or read it from a CMS.
 */

type RawModules = Record<string, string>;

const FIXTURES = '../../../packages/telamon/test/fixtures/';

const ga4Modules = import.meta.glob('../../../packages/telamon/test/fixtures/ga4/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as RawModules;

const edgeModules = import.meta.glob('../../../packages/telamon/test/fixtures/edge/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as RawModules;

const demoModules = import.meta.glob('../../../packages/telamon/test/fixtures/demo/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as RawModules;

/** Strip the glob prefix so keys are bundle-relative, which is what OKF paths are. */
function toBundle(modules: RawModules, name: string): Record<string, string> {
  const prefix = `${FIXTURES}${name}/`;
  return Object.fromEntries(
    Object.entries(modules).map(([path, contents]) => [path.slice(prefix.length), contents]),
  );
}

export const BUNDLES = {
  demo: {
    label: 'Storefront analytics (typed relationships)',
    files: toBundle(demoModules, 'demo'),
  },
  ga4: {
    label: 'GA4 (reference bundle)',
    files: toBundle(ga4Modules, 'ga4'),
  },
  edge: {
    label: 'Edge cases',
    files: toBundle(edgeModules, 'edge'),
  },
} as const;

export type BundleKey = keyof typeof BUNDLES;
