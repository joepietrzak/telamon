/**
 * Where a bundle comes from.
 *
 * `OkfSite` has always taken an in-memory map of path to contents, which left
 * producing that map to every caller -- a directory walk copied out of the
 * docs, a Vite glob, a fetch loop. A source is that step named: something that
 * can produce a bundle's files, and say what went wrong doing it.
 *
 * The interface is deliberately thin. A source knows nothing about React,
 * routing, or rendering, so the same one feeds a build script, a server, or a
 * test.
 */

export interface SourceDiagnostic {
  /** Machine-readable kind, namespaced by the source that raised it. */
  code: string;
  severity: 'warning' | 'info';
  message: string;
  /** Bundle-relative path the diagnostic concerns, where there is one. */
  filePath?: string;
}

export interface SourceResult {
  /** Bundle-relative path to file contents, ready for `parseBundle`. */
  files: Record<string, string>;
  /** Problems reading the source. Never a reason to have thrown. */
  diagnostics: SourceDiagnostic[];
  /**
   * Where this read got to, to hand back to `loadChanged`.
   *
   * Only sources that can answer "what changed since" return one. Its meaning
   * is the source's own -- a modification time, a sequence number, a snapshot
   * id -- and nothing outside the source should interpret it.
   */
  cursor?: SourceCursor;
}

/** Opaque to everything but the source that issued it. */
export type SourceCursor = string | number;

export interface SourceChanges {
  /** Files added or modified since the cursor. */
  changed: Record<string, string>;
  /** Files removed since the cursor, where the source can tell. */
  deleted: string[];
  /** Problems reading. */
  diagnostics: SourceDiagnostic[];
  /** Where to resume next time. Unchanged when nothing moved. */
  cursor: SourceCursor;
}

export interface BundleSource {
  /** Short description for logs and error messages, e.g. `./bundle` or `database`. */
  readonly name: string;
  load(): Promise<SourceResult>;
  /**
   * Call `onChange` when the underlying content changes, and return a function
   * that stops watching. Optional: a database source has nothing to watch, and
   * callers must cope with its absence.
   */
  watch?(onChange: () => void): () => void;
  /**
   * Report what changed since a cursor a previous read returned.
   *
   * Optional, and an optimisation rather than a correctness requirement: a
   * caller without it re-reads everything and compares, which costs a full
   * read but yields the same answer. Implement it when the read itself is the
   * expensive part -- a query against a warehouse, a walk of a large tree.
   *
   * Whether deletions can be reported is the source's business. One that
   * cannot see them says so by never listing any, and the caller reconciles
   * with a periodic full read.
   */
  loadChanged?(since: SourceCursor): Promise<SourceChanges>;
}
