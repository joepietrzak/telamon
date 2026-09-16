import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

const VIRTUAL = 'virtual:okf-manifest';
const RESOLVED = `\0${VIRTUAL}`;

/** Everything up to and including the closing `---`, or nothing. */
function frontmatterOf(text: string): string {
  if (!text.startsWith('---')) return '';
  const end = text.indexOf('\n---', 3);
  return end === -1 ? '' : text.slice(0, end + 4);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * Split a bundle into the part every page needs and the part one page needs.
 *
 * The navigation tree, the search index, the graph and backlinks are built
 * from frontmatter and links -- from what a document *is* and what it points
 * at. Only the body of the document on screen needs the body. On a corpus of
 * two thousand Wikipedia articles frontmatter is 4.9% of the bytes, so shipping
 * it alone is the difference between a first load that carries the corpus and
 * one that carries an index of it.
 *
 * This emits the frontmatter half as a virtual module, inlined the way the
 * eager build inlines everything. The bodies stay behind `import.meta.glob`
 * without `eager`, which makes each one its own hashed chunk, fetched on the
 * navigation that needs it.
 */
export function okfManifest(bundleDir: string): Plugin {
  return {
    name: 'okf-manifest',
    resolveId: (id) => (id === VIRTUAL ? RESOLVED : undefined),
    async load(id) {
      if (id !== RESOLVED) return undefined;
      const files = await walk(bundleDir);
      const manifest: Record<string, string> = {};
      for (const file of files) {
        const text = await readFile(file, 'utf8');
        const key = relative(bundleDir, file).split(sep).join('/');
        // A reserved file carries no frontmatter and is its body -- an index
        // is a list of links, which is exactly what the tree is built from, so
        // it travels whole.
        const base = key.slice(key.lastIndexOf('/') + 1).toLowerCase();
        manifest[key] = base === 'index.md' || base === 'log.md' ? text : frontmatterOf(text);
      }
      return `export const MANIFEST = ${JSON.stringify(manifest)};\n`;
    },
  };
}
