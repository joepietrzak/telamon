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
}
