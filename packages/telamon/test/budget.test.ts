/**
 * The build-time size budget.
 *
 * The failure it exists to prevent is silent: a corpus compiled into the app
 * grows a document at a time, every commit looks fine, and the first person to
 * notice is a reader on a bad connection. So the numbers this reports have to
 * be the ones a visitor actually pays -- which means static imports count and
 * dynamic ones do not.
 */
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  firstLoadChunks,
  formatBytes,
  okfBudget,
  parseSize,
  type OutputBundleLike,
} from '../src/vite/index.js';

const chunk = (
  fileName: string,
  code: string,
  extra: { isEntry?: boolean; imports?: string[]; dynamicImports?: string[] } = {},
) => ({
  type: 'chunk' as const,
  fileName,
  code,
  isEntry: extra.isEntry ?? false,
  imports: extra.imports ?? [],
  dynamicImports: extra.dynamicImports ?? [],
});

/**
 * Incompressible, so a gzipped measurement tracks the length asked for.
 *
 * Real entropy rather than a generated sequence: an arithmetic one is periodic
 * and a small PRNG repeats inside a few hundred kilobytes, and either way gzip
 * finds the repeat and the budget never trips.
 */
const noise = (bytes: number) => randomBytes(bytes).toString('base64').slice(0, bytes);

const run = (output: OutputBundleLike, options: Parameters<typeof okfBudget>[0], context = {}) =>
  okfBudget(options).generateBundle.call(context, {}, output);

describe('parseSize', () => {
  it('reads the forms a budget is written in', () => {
    expect(parseSize(900_000)).toBe(900_000);
    expect(parseSize('1024')).toBe(1024);
    expect(parseSize('1 MB')).toBe(1024 ** 2);
    expect(parseSize('1.5mb')).toBe(Math.round(1.5 * 1024 ** 2));
    expect(parseSize('512 KB')).toBe(512 * 1024);
  });

  it('refuses anything it would have to guess at', () => {
    for (const bad of ['', 'big', '-1', '0', 'MB', '1 parsec', Number.NaN, 0, -5]) {
      expect(() => parseSize(bad as string | number), String(bad)).toThrow(TypeError);
    }
  });
});

describe('formatBytes', () => {
  it('reads the way a person would say it', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 ** 2)).toBe('3.00 MB');
    expect(formatBytes(44 * 1024 ** 2)).toBe('44.0 MB');
  });
});

describe('firstLoadChunks', () => {
  it('follows static imports and stops at dynamic ones', () => {
    const output: OutputBundleLike = {
      'entry.js': chunk('entry.js', 'a', { isEntry: true, imports: ['shared.js'], dynamicImports: ['doc.js'] }),
      'shared.js': chunk('shared.js', 'b', { imports: ['deep.js'] }),
      'deep.js': chunk('deep.js', 'c'),
      'doc.js': chunk('doc.js', 'd'),
      'orphan.js': chunk('orphan.js', 'e'),
      'styles.css': { type: 'asset' as const, fileName: 'styles.css', source: 'body{}' },
    };

    // Transitively reachable without an `import()`, and nothing else.
    expect(firstLoadChunks(output).map((c) => c.fileName).sort()).toEqual([
      'deep.js',
      'entry.js',
      'shared.js',
    ]);
  });

  it('does not loop on chunks that import each other', () => {
    const output: OutputBundleLike = {
      'a.js': chunk('a.js', 'a', { isEntry: true, imports: ['b.js'] }),
      'b.js': chunk('b.js', 'b', { imports: ['a.js'] }),
    };
    expect(firstLoadChunks(output)).toHaveLength(2);
  });
});

describe('okfBudget', () => {
  const big = noise(400_000);

  it('says nothing when the build is within budget', () => {
    const output: OutputBundleLike = { 'entry.js': chunk('entry.js', 'small', { isEntry: true }) };
    expect(() => run(output, { max: '1 MB' })).not.toThrow();
  });

  it('fails a build whose first load is over', () => {
    const output: OutputBundleLike = { 'entry.js': chunk('entry.js', big, { isEntry: true }) };
    expect(() => run(output, { max: '100 KB' })).toThrow(/First load is .* over the 100.0 KB budget/s);
  });

  it('names the biggest chunks and what to do about it', () => {
    const output: OutputBundleLike = {
      'entry.js': chunk('entry.js', big, { isEntry: true, imports: ['vendor.js'] }),
      'vendor.js': chunk('vendor.js', noise(1000)),
    };
    expect(() => run(output, { max: '1 KB' })).toThrow(/entry\.js/);
    expect(() => run(output, { max: '1 KB' })).toThrow(/okfManifest/);
  });

  it('ignores a corpus that was split behind dynamic imports', () => {
    // The same bytes, reachable only by `import()`: this is what splitting is
    // supposed to buy, so the budget has to stop counting it.
    const output: OutputBundleLike = {
      'entry.js': chunk('entry.js', 'small', { isEntry: true, dynamicImports: ['body.js'] }),
      'body.js': chunk('body.js', big),
    };
    expect(() => run(output, { max: '10 KB' })).not.toThrow();
  });

  it('measures the wire by default and the disk on request', () => {
    const code = 'x'.repeat(200_000); // compresses hard, so the two differ a lot
    const output: OutputBundleLike = { 'entry.js': chunk('entry.js', code, { isEntry: true }) };
    expect(gzipSync(code).byteLength).toBeLessThan(10_000);

    expect(() => run(output, { max: '50 KB' })).not.toThrow();
    expect(() => run(output, { max: '50 KB', measure: 'raw' })).toThrow(/uncompressed/);
  });

  it('warns instead of failing when asked, through the build log', () => {
    const warn = vi.fn();
    const output: OutputBundleLike = { 'entry.js': chunk('entry.js', big, { isEntry: true }) };
    expect(() => run(output, { max: '1 KB', action: 'warn' }, { warn })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('over the 1.0 KB budget'));
  });

  it('reports through the build rather than a bare throw when it can', () => {
    const error = vi.fn(() => {
      throw new Error('reported');
    });
    const output: OutputBundleLike = { 'entry.js': chunk('entry.js', big, { isEntry: true }) };
    expect(() => run(output, { max: '1 KB' }, { error })).toThrow('reported');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('First load is'));
  });

  it('rejects an unreadable budget when the plugin is created, not at the end of a build', () => {
    expect(() => okfBudget({ max: 'enormous' })).toThrow(TypeError);
  });
});
