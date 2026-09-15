// @vitest-environment node
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileSource } from '../src/source/index.js';
import { fixturePath, readFixture } from './helpers.js';

const made: string[] = [];

async function scratch(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'telamon-source-'));
  made.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, contents, 'utf8');
  }
  return root;
}

afterEach(() => {
  made.length = 0;
});

describe('fileSource', () => {
  it('reads a bundle directory into the shape parseBundle takes', async () => {
    const source = fileSource(fixturePath('demo'));
    const { files, diagnostics } = await source.load();

    // The same map the test helper builds by walking the directory itself.
    expect(files).toEqual(readFixture('demo'));
    expect(diagnostics).toEqual([]);
  });

  it('keeps nested paths POSIX and bundle-relative', async () => {
    const { files } = await fileSource(fixturePath('demo')).load();
    expect(Object.keys(files)).toContain('metrics/gross_revenue.md');
    expect(Object.keys(files).every((path) => !path.startsWith('/'))).toBe(true);
  });

  it('reads markdown alone unless told otherwise', async () => {
    const root = await scratch({
      'index.md': '# Root',
      'notes.txt': 'not markdown',
      'data.csv': 'a,b',
    });

    expect(Object.keys((await fileSource(root).load()).files)).toEqual(['index.md']);
    expect(
      Object.keys((await fileSource(root, { extensions: ['.md', '.csv'] }).load()).files).sort(),
    ).toEqual(['data.csv', 'index.md']);
  });

  it('skips dotfiles and the usual noise by default', async () => {
    const root = await scratch({
      'index.md': '# Root',
      '.hidden.md': '# Hidden',
      'node_modules/pkg/readme.md': '# Dependency',
      '.git/notes.md': '# Internal',
    });

    expect(Object.keys((await fileSource(root).load()).files)).toEqual(['index.md']);
  });

  it('takes ignore globs, matching across and within directories', async () => {
    const root = await scratch({
      'index.md': '# Root',
      'drafts/wip.md': '# Draft',
      'metrics/revenue.md': '# Revenue',
      'metrics/scratch.tmp.md': '# Scratch',
    });

    const { files } = await fileSource(root, {
      ignore: ['drafts/**', '**/*.tmp.md'],
    }).load();

    expect(Object.keys(files).sort()).toEqual(['index.md', 'metrics/revenue.md']);
  });

  it('reports a directory that yielded nothing', async () => {
    const root = await scratch({ 'notes.txt': 'no markdown here' });
    const { files, diagnostics } = await fileSource(root).load();

    expect(files).toEqual({});
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'empty-source', severity: 'warning' }),
    );
  });

  it('skips a file over the size ceiling, and says which', async () => {
    const root = await scratch({ 'index.md': '# Root', 'huge.md': 'x'.repeat(2048) });
    const { files, diagnostics } = await fileSource(root, { maxFileSize: 1024 }).load();

    expect(Object.keys(files)).toEqual(['index.md']);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'file-too-large', filePath: 'huge.md' }),
    );
  });

  it('throws on a root that is not there, rather than serving an empty bundle', async () => {
    await expect(fileSource(join(tmpdir(), 'telamon-does-not-exist')).load()).rejects.toThrow(
      /cannot read/,
    );
  });

  it('ignores symlinks unless asked, and never loops when asked', async () => {
    const root = await scratch({ 'index.md': '# Root', 'real/page.md': '# Page' });
    // A directory symlink pointing at its own ancestor: the loop case.
    await symlink(root, join(root, 'real', 'loop'), 'dir');

    expect(Object.keys((await fileSource(root).load()).files).sort()).toEqual([
      'index.md',
      'real/page.md',
    ]);

    // Following the link resolves it back to the root, which is already walked,
    // so the tree is read exactly once rather than endlessly re-entered.
    const followed = await fileSource(root, { followSymlinks: true }).load();
    expect(Object.keys(followed.files).sort()).toEqual(['index.md', 'real/page.md']);
  });

  it('hands back a cursor to resume from', async () => {
    const root = await scratch({ 'index.md': '# Root\n' });
    const { cursor } = await fileSource(root).load();
    expect(typeof cursor).toBe('number');
  });
});

describe('fileSource.loadChanged', () => {
  /**
   * Modification times have coarse resolution on some filesystems, so a file
   * written moments after a cursor can share its timestamp. Stamping
   * explicitly keeps these tests about the logic rather than the clock.
   */
  async function touch(root: string, path: string, mtimeMs: number) {
    const when = new Date(mtimeMs);
    await utimes(join(root, path), when, when);
  }

  it('reads only what was written since the cursor', async () => {
    const root = await scratch({
      'index.md': '# Root\n',
      'a.md': '---\ntype: Metric\n---\n\nOne.\n',
      'b.md': '---\ntype: Metric\n---\n\nTwo.\n',
    });
    const source = fileSource(root);

    await touch(root, 'index.md', 1_000);
    await touch(root, 'a.md', 1_000);
    await touch(root, 'b.md', 1_000);
    const first = await source.load();
    expect(Object.keys(first.files).sort()).toEqual(['a.md', 'b.md', 'index.md']);

    await writeFile(join(root, 'b.md'), '---\ntype: Metric\n---\n\nTwo, revised.\n', 'utf8');
    await touch(root, 'b.md', 5_000);

    const changes = await source.loadChanged!(first.cursor!);
    expect(Object.keys(changes.changed)).toEqual(['b.md']);
    expect(changes.changed['b.md']).toContain('revised');
    expect(changes.deleted).toEqual([]);
    expect(changes.cursor).toBe(5_000);
  });

  it('sees a deletion, because it walks the tree either way', async () => {
    const root = await scratch({ 'index.md': '# Root\n', 'gone.md': '---\ntype: Metric\n---\n\nHere.\n' });
    const source = fileSource(root);
    const first = await source.load();

    await rm(join(root, 'gone.md'));

    const changes = await source.loadChanged!(first.cursor!);
    expect(changes.deleted).toEqual(['gone.md']);
    expect(Object.keys(changes.changed)).toEqual([]);
  });

  it('sees a file added after the cursor', async () => {
    const root = await scratch({ 'index.md': '# Root\n' });
    const source = fileSource(root);
    await touch(root, 'index.md', 1_000);
    const first = await source.load();

    await writeFile(join(root, 'new.md'), '---\ntype: Metric\n---\n\nNew.\n', 'utf8');
    await touch(root, 'new.md', 9_000);

    const changes = await source.loadChanged!(first.cursor!);
    expect(Object.keys(changes.changed)).toEqual(['new.md']);
    expect(changes.cursor).toBe(9_000);
  });

  it('reports nothing, and holds its place, when nothing moved', async () => {
    const root = await scratch({ 'index.md': '# Root\n', 'a.md': '---\ntype: Metric\n---\n\nOne.\n' });
    const source = fileSource(root);
    await touch(root, 'index.md', 1_000);
    await touch(root, 'a.md', 1_000);
    const first = await source.load();

    const changes = await source.loadChanged!(first.cursor!);
    expect(changes.changed).toEqual({});
    expect(changes.deleted).toEqual([]);
    expect(changes.cursor).toBe(first.cursor);
  });

  it('still applies ignore rules and the size ceiling', async () => {
    const root = await scratch({ 'index.md': '# Root\n' });
    const source = fileSource(root, { ignore: ['drafts/**'] });
    await touch(root, 'index.md', 1_000);
    const first = await source.load();

    await mkdir(join(root, 'drafts'), { recursive: true });
    await writeFile(join(root, 'drafts', 'wip.md'), '---\ntype: Metric\n---\n\nWip.\n', 'utf8');
    await touch(root, 'drafts/wip.md', 9_000);

    const changes = await source.loadChanged!(first.cursor!);
    expect(Object.keys(changes.changed)).toEqual([]);
  });
});

describe('fileSource naming', () => {
  it('names itself for logs', () => {
    expect(fileSource('./bundle').name).toBe('./bundle');
  });
});
