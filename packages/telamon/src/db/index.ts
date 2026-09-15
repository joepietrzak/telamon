/**
 * `telamon/db` -- read an OKF bundle out of a database.
 *
 * Node-side only, and deliberately driver-free: you supply a query function,
 * telamon supplies the mapping from tables to a filesystem. Nothing here
 * imports React or touches the DOM, so it is safe in a loader, a server
 * component, or a build script.
 */
export {
  parseDbConfig,
  type DbConfig,
  type DirectoryInfo,
  type Row,
  type TableMapping,
} from './config.js';

export {
  rowsToFiles,
  type DbDiagnostic,
  type DbDiagnosticCode,
  type MappedBundle,
} from './mapping.js';

export { buildStatement, loadBundle, type QueryFn, type QueryResult } from './load.js';

export { databaseSource } from './source.js';
