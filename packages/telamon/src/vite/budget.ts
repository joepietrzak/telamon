import { gzipSync } from 'node:zlib';
import type {
  OutputBundleLike,
  OutputChunkLike,
  RollupContextLike,
  VitePluginLike,
} from './manifest.js';

export interface OkfBudgetOptions {
  /**
   * Largest first load to allow: a byte count, or a string like `"1.5 MB"`.
   *
   * Units are powers of two (`KB` is 1024 bytes), and the string form is there
   * because a budget is a number a team agrees on out loud.
   */
  max: number | string;
  /** Measure what crosses the wire (the default) or the bytes on disk. */
  measure?: 'gzip' | 'raw';
  /** Fail the build, which is the point, or merely say so. */
  action?: 'error' | 'warn';
}

export type OkfBudgetPlugin = VitePluginLike & Required<Pick<VitePluginLike, 'generateBundle'>>;

const UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

/** `"1.5 MB"` -> bytes. Throws on anything it cannot read, at config time. */
export function parseSize(value: number | string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`Budget must be a positive number of bytes, received ${value}.`);
    }
    return value;
  }
  const match = /^\s*([\d.]+)\s*([a-z]*)\s*$/i.exec(value);
  const size = match ? Number(match[1]) : Number.NaN;
  // `||` not `??`: a size with no unit matches as an empty string, not as absent.
  const unit = UNITS[(match?.[2] || 'b').toLowerCase()];
  if (!Number.isFinite(size) || size <= 0 || unit === undefined) {
    throw new TypeError(`Budget "${value}" is not a size; try 900000 or "1.5 MB".`);
  }
  return Math.round(size * unit);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / 1024 ** 2;
  return mb >= 1 ? `${mb.toFixed(mb < 10 ? 2 : 1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

const isChunk = (item: OutputBundleLike[string]): item is OutputChunkLike => item.type === 'chunk';

/**
 * The chunks a visitor downloads before anything renders.
 *
 * Entry chunks plus everything they reach by static import, and deliberately
 * not what sits behind `import()` -- a chunk fetched on the navigation that
 * needs it is not part of the first load, which is the entire distinction
 * between inlining a corpus and shipping an index of it.
 */
export function firstLoadChunks(output: OutputBundleLike): OutputChunkLike[] {
  const chunks = new Map<string, OutputChunkLike>();
  for (const item of Object.values(output)) {
    if (isChunk(item)) chunks.set(item.fileName, item);
  }

  const reached = new Set<string>();
  const queue = [...chunks.values()].filter((chunk) => chunk.isEntry).map((c) => c.fileName);
  while (queue.length > 0) {
    const fileName = queue.pop()!;
    if (reached.has(fileName)) continue;
    reached.add(fileName);
    // `imports` only; `dynamicImports` is the part that waits.
    for (const next of chunks.get(fileName)?.imports ?? []) {
      if (chunks.has(next) && !reached.has(next)) queue.push(next);
    }
  }
  return [...reached].map((fileName) => chunks.get(fileName)!);
}

function sizeOf(chunk: OutputChunkLike, measure: 'gzip' | 'raw'): number {
  const raw = Buffer.byteLength(chunk.code);
  return measure === 'raw' ? raw : gzipSync(chunk.code).byteLength;
}

/**
 * Fail a build whose first load got too big.
 *
 * A bundler that inlines an OKF bundle inlines all of it, and nothing in the
 * build says so: the corpus grows a document at a time, every commit looks
 * fine, and the size is discovered by a reader on a bad connection. Measured
 * on 2000 Wikipedia articles the entry chunk reaches 44.6 MB, 14 MB gzipped.
 *
 * This puts the number in front of whoever added the document, in CI, where it
 * is still cheap to decide about. It measures the chunks a visitor must have
 * before anything renders -- entries plus static imports, never dynamic ones --
 * so splitting bodies out with `okfManifest` moves the needle honestly.
 *
 * ```ts
 * plugins: [react(), okfBudget({ max: '1 MB' })]
 * ```
 */
export function okfBudget(options: OkfBudgetOptions): OkfBudgetPlugin {
  // Read the budget now rather than at the end of a long build: a typo in a
  // config should not cost a compile first.
  const max = parseSize(options.max);
  const measure = options.measure ?? 'gzip';
  const action = options.action ?? 'error';

  return {
    name: 'telamon:okf-budget',

    generateBundle(this: RollupContextLike, _options, output) {
      const chunks = firstLoadChunks(output);
      if (chunks.length === 0) return;

      const sized = chunks
        .map((chunk) => ({ fileName: chunk.fileName, bytes: sizeOf(chunk, measure) }))
        .sort((a, b) => b.bytes - a.bytes);
      const total = sized.reduce((sum, chunk) => sum + chunk.bytes, 0);
      const label = measure === 'gzip' ? 'gzipped' : 'uncompressed';

      if (total <= max) return;

      const biggest = sized
        .slice(0, 3)
        .map((chunk) => `  ${chunk.fileName}  ${formatBytes(chunk.bytes)}`)
        .join('\n');
      const message =
        `First load is ${formatBytes(total)} ${label} across ${sized.length} ` +
        `chunk${sized.length === 1 ? '' : 's'}, over the ${formatBytes(max)} budget.\n` +
        `${biggest}\n` +
        'If a chunk that size is an OKF bundle compiled into the app, `okfManifest` ' +
        'from telamon/vite and `useLazyBundle` ship the frontmatter and fetch each ' +
        'body on the navigation that needs it.';

      if (action === 'warn') {
        if (this.warn) this.warn(message);
        else console.warn(message);
        return;
      }
      if (this.error) this.error(message);
      throw new Error(message);
    },
  };
}
