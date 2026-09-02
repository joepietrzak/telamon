import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

// Resolved from the working directory rather than `import.meta.url`: these
// helpers run under the jsdom environment, where module URLs are not file URLs.
const candidates = ['test/fixtures', 'packages/telamon/test/fixtures'];
const found = candidates
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));

if (!found) throw new Error('Could not locate the test fixtures directory.');
const fixturesDir = found;

/** Walk a fixture directory into the `Record<path, contents>` shape `parseBundle` takes. */
export function readFixture(name: string): Record<string, string> {
  const root = join(fixturesDir, name);
  const files: Record<string, string> = {};

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(root, full).split(sep).join('/')] = readFileSync(full, 'utf8');
    }
  };

  walk(root);
  return files;
}
