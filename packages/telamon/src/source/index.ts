/**
 * `telamon/source` -- where a bundle's files come from.
 *
 * Node-side. A `BundleSource` produces the same path-to-contents map `OkfSite`
 * takes, so a filesystem, a database, or anything else you implement are
 * interchangeable to everything downstream.
 */
export type { BundleSource, SourceDiagnostic, SourceResult } from './types.js';
export { fileSource, type FileSourceOptions } from './file.js';
