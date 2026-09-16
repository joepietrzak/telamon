import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * The plugin shape, structurally.
 *
 * telamon does not depend on Vite -- a documentation renderer that drags a
 * bundler into everyone's install is a worse library -- so the hooks are typed
 * by what they are rather than by importing `Plugin`. The result satisfies
 * Vite's interface, which is all `plugins: [okfManifest(...)]` needs.
 */
export interface VitePluginLike {
  name: string;
  resolveId(id: string): string | undefined;
  load(this: { addWatchFile?: (id: string) => void }, id: string): Promise<string | undefined>;
  configureServer(server: ViteServerLike): void;
}

/** The part of a Vite dev server this needs: a watcher, a module graph, a socket. */
export interface ViteServerLike {
  watcher: { add(path: string): void; on(event: string, handler: (path: string) => void): void };
  moduleGraph: {
    getModuleById(id: string): { id: string | null } | undefined;
    invalidateModule(module: { id: string | null }): void;
  };
  ws: { send(payload: { type: 'full-reload' }): void };
}

export interface OkfManifestOptions {
  /** Directory holding the bundle's markdown. Relative paths resolve from `cwd`. */
  dir: string;
  /** Module id to serve the manifest under. Defaults to `virtual:okf-manifest`. */
  id?: string;
}

export const DEFAULT_MANIFEST_ID = 'virtual:okf-manifest';

/**
 * The frontmatter half of a document: everything up to and including the
 * closing `---`.
 *
 * Reserved files are returned whole. An `index.md` carries no frontmatter and
 * *is* a list of links, which is exactly what the navigation tree is built
 * from -- splitting it would take away the thing that makes it useful.
 */
export function manifestEntry(filePath: string, contents: string): string {
  const base = filePath.slice(filePath.lastIndexOf('/') + 1).toLowerCase();
  if (base === 'index.md' || base === 'log.md') return contents;
  if (!contents.startsWith('---')) return '';
  const end = contents.indexOf('\n---', 3);
  return end === -1 ? '' : contents.slice(0, end + 4);
}

async function markdownIn(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownIn(full)));
    else if (entry.name.toLowerCase().endsWith('.md')) found.push(full);
  }
  return found.sort();
}

/**
 * Split a bundle into the part every page needs and the part one page needs.
 *
 * A bundler that inlines an OKF bundle inlines all of it, so first load is
 * O(corpus): two thousand documents of encyclopedia prose is 44 MB of
 * JavaScript and half a minute before anything is on screen. But almost none of
 * that is needed to draw a page. The navigation tree, the search index, the
 * graph and backlinks are built from frontmatter and links -- from what a
 * document *is* and what it points at. Only the body of the document on screen
 * needs a body, and frontmatter is a few percent of the bytes.
 *
 * So the virtual module exports two things: `MANIFEST`, the frontmatter of
 * every document, inlined; and `BODIES`, a loader per document that compiles to
 * a dynamic import, which makes each body its own chunk fetched on the
 * navigation that wants it. `useLazyBundle` consumes exactly that pair.
 *
 * ```ts
 * // vite.config.ts
 * plugins: [react(), okfManifest({ dir: './bundle' })]
 * ```
 *
 * Both maps are keyed by bundle-relative path -- `metrics/revenue.md` -- which
 * is what an OKF path is and what the rest of telamon expects.
 */
export function okfManifest(options: OkfManifestOptions): VitePluginLike {
  const dir = isAbsolute(options.dir) ? options.dir : resolve(process.cwd(), options.dir);
  const id = options.id ?? DEFAULT_MANIFEST_ID;
  const resolved = `\0${id}`;

  return {
    name: 'telamon:okf-manifest',

    resolveId: (source) => (source === id ? resolved : undefined),

    async load(source) {
      if (source !== resolved) return undefined;

      const files = await markdownIn(dir);
      const manifest: Record<string, string> = {};
      const bodies: string[] = [];

      for (const file of files) {
        // `vite build --watch` only re-runs this when it knows the inputs.
        this.addWatchFile?.(file);
        const key = relative(dir, file).split(sep).join('/');
        manifest[key] = manifestEntry(key, await readFile(file, 'utf8'));
        // Absolute, because a virtual module has no directory to be relative
        // to. `?raw` hands back the text rather than a parsed module.
        const specifier = JSON.stringify(`${file.split(sep).join('/')}?raw`);
        bodies.push(
          `  ${JSON.stringify(key)}: () => import(${specifier}).then((m) => m.default),`,
        );
      }

      return (
        `export const MANIFEST = ${JSON.stringify(manifest)};\n` +
        `export const BODIES = {\n${bodies.join('\n')}\n};\n`
      );
    },

    configureServer(server) {
      server.watcher.add(dir);
      const changed = (path: string): void => {
        if (!path.toLowerCase().endsWith('.md') || !path.startsWith(dir)) return;
        const module = server.moduleGraph.getModuleById(resolved);
        if (module) server.moduleGraph.invalidateModule(module);
        // The manifest decides routes and the navigation tree, so a document
        // appearing or its frontmatter changing is a different site, not a
        // different component.
        server.ws.send({ type: 'full-reload' });
      };
      for (const event of ['add', 'change', 'unlink']) server.watcher.on(event, changed);
    },
  };
}
