import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { watch as watchFs } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { normalizeFilePath } from '../bundle/paths.js';
import type { BundleSource, SourceDiagnostic, SourceResult } from './types.js';

export interface FileSourceOptions {
  /**
   * Extensions to read, with the dot. Defaults to markdown alone: everything
   * else in a bundle directory is an asset the host serves by URL rather than
   * something `parseBundle` has any use for.
   */
  extensions?: string[];
  /** Glob patterns to skip, matched against bundle-relative paths. */
  ignore?: string[];
  /** Read entries whose name begins with a dot. Off by default. */
  includeDotfiles?: boolean;
  /** Skip files larger than this many bytes, with a diagnostic. Defaults to 5 MB. */
  maxFileSize?: number;
  /** Follow symlinked directories. Off by default, since a loop would not end. */
  followSymlinks?: boolean;
}

const DEFAULT_EXTENSIONS = ['.md'];
const DEFAULT_IGNORE = ['**/node_modules/**', '**/.git/**'];
const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Translate a glob to a regular expression.
 *
 * Supports the three forms a bundle actually needs: `**` across directories,
 * `*` within one, and `?` for a single character. Anything beyond that is a
 * dependency, and `ignore` is a list of paths to skip rather than a query
 * language.
 */
function globToRegExp(pattern: string): RegExp {
  let body = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]!;
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          // `**/` spans any number of directories, including none at all.
          body += '(?:.*/)?';
          i += 2;
        } else {
          body += '.*';
          i += 1;
        }
      } else {
        body += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      body += '[^/]';
      continue;
    }
    body += char.replace(/[.+^${}()|[\]\\]/, '\\$&');
  }
  return new RegExp(`^${body}$`);
}

/**
 * Read a bundle from a directory on disk.
 *
 * This is the recipe that used to live in the getting-started guide as a
 * snippet to copy, promoted into the library so it can carry the parts a real
 * one needs: ignore rules, a size ceiling, symlink safety, and a diagnostic for
 * every file it declined to read.
 */
export function fileSource(root: string, options: FileSourceOptions = {}): BundleSource {
  const {
    extensions = DEFAULT_EXTENSIONS,
    ignore = DEFAULT_IGNORE,
    includeDotfiles = false,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    followSymlinks = false,
  } = options;

  const absoluteRoot = resolve(root);
  const patterns = ignore.map(globToRegExp);
  const ignored = (path: string) => patterns.some((pattern) => pattern.test(path));
  const wanted = (name: string) => extensions.some((ext) => name.toLowerCase().endsWith(ext));

  const toBundlePath = (absolute: string) =>
    normalizeFilePath(relative(absoluteRoot, absolute).split(sep).join('/'));

  async function load(): Promise<SourceResult> {
    const files: Record<string, string> = {};
    const diagnostics: SourceDiagnostic[] = [];
    /**
     * Directories already walked, keyed by their *resolved* path.
     *
     * The literal path is no good as a key: a symlink pointing at an ancestor
     * produces an endlessly deeper string -- `a/link/a/link/...` -- every level
     * of which looks new, so the walk only stops when the OS refuses the name.
     */
    const seen = new Set<string>();

    const identity = async (path: string) => {
      try {
        return await realpath(path);
      } catch {
        return path;
      }
    };

    async function walk(dir: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        diagnostics.push({
          code: 'unreadable-directory',
          severity: 'warning',
          filePath: toBundlePath(dir),
          message: `Could not read ${dir}: ${(error as Error).message}`,
        });
        return;
      }

      for (const entry of entries) {
        if (!includeDotfiles && entry.name.startsWith('.')) continue;

        const absolute = join(dir, entry.name);
        const path = toBundlePath(absolute);
        let isDirectory = entry.isDirectory();

        if (entry.isSymbolicLink()) {
          if (!followSymlinks) continue;
          try {
            isDirectory = (await stat(absolute)).isDirectory();
          } catch {
            diagnostics.push({
              code: 'broken-symlink',
              severity: 'warning',
              filePath: path,
              message: `"${path}" is a symlink pointing nowhere.`,
            });
            continue;
          }
        }

        if (isDirectory) {
          if (ignored(`${path}/`)) continue;
          const key = await identity(absolute);
          if (seen.has(key)) continue;
          seen.add(key);
          await walk(absolute);
          continue;
        }

        if (!wanted(entry.name) || ignored(path)) continue;

        try {
          const info = await stat(absolute);
          if (info.size > maxFileSize) {
            diagnostics.push({
              code: 'file-too-large',
              severity: 'warning',
              filePath: path,
              message: `"${path}" is ${info.size} bytes, over the ${maxFileSize}-byte ceiling, and was skipped.`,
            });
            continue;
          }
          files[path] = await readFile(absolute, 'utf8');
        } catch (error) {
          diagnostics.push({
            code: 'unreadable-file',
            severity: 'warning',
            filePath: path,
            message: `Could not read "${path}": ${(error as Error).message}`,
          });
        }
      }
    }

    try {
      if (!(await stat(absoluteRoot)).isDirectory()) {
        throw new Error('not a directory');
      }
    } catch (error) {
      // A missing root is wiring rather than content: the caller pointed at
      // somewhere that is not there, and every later diagnostic would be noise
      // about a tree that does not exist.
      throw new Error(`fileSource cannot read ${absoluteRoot}: ${(error as Error).message}`);
    }

    // Seed with the root, so a symlink pointing back at it is caught at once.
    seen.add(await identity(absoluteRoot));
    await walk(absoluteRoot);

    if (Object.keys(files).length === 0) {
      diagnostics.push({
        code: 'empty-source',
        severity: 'warning',
        message: `No files matching ${extensions.join(', ')} under ${absoluteRoot}.`,
      });
    }

    return { files, diagnostics };
  }

  return {
    name: root,
    load,
    watch(onChange: () => void) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      // One save can fire several events; coalesce so it rebuilds once.
      const fire = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(onChange, 50);
      };

      let watcher: ReturnType<typeof watchFs> | undefined;
      try {
        watcher = watchFs(absoluteRoot, { recursive: true }, fire);
      } catch {
        // Recursive watching is not available everywhere. Serving without live
        // reload beats refusing to start.
        return () => {};
      }

      return () => {
        if (timer) clearTimeout(timer);
        watcher?.close();
      };
    },
  };
}
