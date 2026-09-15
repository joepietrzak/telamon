import type { BundleSource, SourceChanges, SourceCursor } from '../source/types.js';
import { parseDbConfig, type DbConfig } from './config.js';
import {
  loadBundle,
  loadChangedBundle,
  tracksChanges,
  type Placeholder,
  type QueryFn,
} from './load.js';

export interface DatabaseSourceOptions {
  /** Name for logs. Defaults to `database`. */
  name?: string;
  /** How this engine writes a bound parameter. Defaults to `?`. */
  placeholder?: Placeholder;
}

/**
 * A `BundleSource` backed by a database.
 *
 * The same mapping `loadBundle` takes, wrapped so a server can accept a
 * database and a directory interchangeably and never learn which it got.
 *
 * When every mapping declares a `changedColumn`, the source can also answer
 * "what changed since", which lets a server refresh without re-querying whole
 * tables. That answer is narrower than a full read -- it sees neither
 * deletions nor the synthesized index files -- so a server using it should
 * still read in full from time to time. See `loadChangedBundle`.
 */
export function databaseSource(
  config: DbConfig | unknown,
  query: QueryFn,
  options: DatabaseSourceOptions = {},
): BundleSource {
  const parsed = parseDbConfig(config);
  const { name = 'database', placeholder } = options;

  const source: BundleSource = {
    name,
    load: async () => {
      const { files, diagnostics, cursor } = await loadBundle(parsed, query);
      // A first read starts the clock, so the next one can ask for what
      // changed rather than everything.
      return {
        files,
        diagnostics,
        ...(tracksChanges(parsed) && { cursor: cursor ?? startingCursor() }),
      };
    },
  };

  if (tracksChanges(parsed)) {
    source.loadChanged = async (since: SourceCursor): Promise<SourceChanges> => {
      const changed = await loadChangedBundle(parsed, query, since, {
        ...(placeholder && { placeholder }),
      });
      return {
        changed: changed.files,
        // A query for what changed cannot see what is gone.
        deleted: [],
        diagnostics: changed.diagnostics,
        cursor: changed.cursor,
      };
    };
  }

  return source;
}

/**
 * Where a first read leaves the cursor when the rows could not say.
 *
 * The empty string sorts before every timestamp and every sequence rendered as
 * text, so the read that follows asks for everything. That is the right answer
 * only when there is nothing better: a full read now reports the
 * furthest-forward `changedColumn` it actually saw, and that is what the source
 * hands back instead. Falling back to `''` costs a scan; falling back to "now"
 * would silently skip whatever was written while the first read was in flight.
 *
 * A watermark taken from rows is not a perfect fence either. A transaction can
 * commit after the read with a `changedColumn` stamped before it -- clock skew,
 * or a value assigned at statement start -- and an incremental read will never
 * go back for it. That is what `refresh({ full: true })` on a slower cycle is
 * for, and why the handler documents it as the thing to run underneath.
 */
function startingCursor(): SourceCursor {
  return '';
}
