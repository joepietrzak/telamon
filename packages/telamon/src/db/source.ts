import type { BundleSource } from '../source/types.js';
import type { DbConfig } from './config.js';
import { loadBundle, type QueryFn } from './load.js';

/**
 * A `BundleSource` backed by a database.
 *
 * The same mapping `loadBundle` takes, wrapped so a server can accept a
 * database and a directory interchangeably and never learn which it got.
 */
export function databaseSource(
  config: DbConfig | unknown,
  query: QueryFn,
  options: { name?: string } = {},
): BundleSource {
  return {
    name: options.name ?? 'database',
    load: () => loadBundle(config, query),
  };
}
