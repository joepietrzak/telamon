/**
 * Types for the module `okfManifest` serves.
 *
 * Reference it once, anywhere in your app's TypeScript:
 *
 * ```ts
 * /// <reference types="telamon/vite-client" />
 * ```
 *
 * A plugin configured with a custom `id` needs its own declaration; this one
 * covers the default.
 */
declare module 'virtual:okf-manifest' {
  /** Frontmatter of every document, keyed by bundle-relative path. */
  export const MANIFEST: Record<string, string>;
  /** Loader per bundle-relative path, returning that document's full text. */
  export const BODIES: Record<string, () => Promise<string>>;
}
