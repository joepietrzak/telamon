import { stringify } from 'yaml';
import { dirOf, normalizeFilePath, stemOf } from '../bundle/paths.js';
import { humanize } from '../bundle/tree.js';
import type { DbConfig, DirectoryInfo, Row, TableMapping } from './config.js';

export type DbDiagnosticCode =
  | 'missing-column'
  | 'empty-path-segment'
  | 'invalid-json'
  | 'path-collision'
  | 'empty-result'
  | 'empty-body';

export interface DbDiagnostic {
  code: DbDiagnosticCode;
  severity: 'warning' | 'info';
  message: string;
  /** The mapping's `table`, or its index when the mapping used raw `sql`. */
  table?: string;
  /** Bundle-relative path the diagnostic concerns. */
  filePath?: string;
}

export interface MappedBundle {
  /** Ready for `parseBundle` or `OkfSite`. */
  files: Record<string, string>;
  diagnostics: DbDiagnostic[];
}

const PLACEHOLDER = /\{([^}]+)\}/g;

/**
 * A path segment safe to route on, with underscores kept.
 *
 * Database names are snake_case and OKF filenames commonly are too, so
 * `order_items` should stay `order_items` rather than becoming `order-items`.
 */
function slug(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
}

/** Frontmatter is authored YAML, so values have to land as YAML scalars. */
function frontmatterValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (ArrayBuffer.isView(value)) return undefined;
  return value;
}

function serialize(frontmatter: Record<string, unknown>, body: string): string {
  const trimmed = body.trim();
  if (Object.keys(frontmatter).length === 0) return `${trimmed}\n`;
  // `lineWidth: 0` keeps descriptions on one line; a folded scalar is valid YAML
  // but makes the generated file needlessly hard to diff against a hand-written one.
  const yaml = stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${trimmed}\n`;
}

function labelFor(mapping: TableMapping, index: number): string {
  return mapping.table ?? `tables[${index}]`;
}

interface Produced {
  filePath: string;
  title: string;
  description?: string;
}

/**
 * Fill `{column}` placeholders from a row.
 *
 * Returns undefined when a column the template names is absent from the row --
 * a mapping that points at a column the query did not return is a wiring
 * mistake worth reporting, not a row to guess at.
 */
function interpolate(
  template: string,
  row: Row,
  transform: (value: unknown) => string,
  missing: string[],
  /** Columns that were present but produced nothing. Only a path cares. */
  empty?: string[],
): string {
  return template.replace(PLACEHOLDER, (_, column: string) => {
    if (!(column in row)) {
      missing.push(column);
      return '';
    }
    const value = transform(row[column]);
    if (value === '' && empty) empty.push(column);
    return value;
  });
}

/**
 * Turn query results into bundle files.
 *
 * Pure and driver-free: `results[i]` holds the rows for `config.tables[i]`.
 * Everything that could go wrong with the *data* becomes a diagnostic, in
 * keeping with `parseBundle` -- a bundle with one unmappable row should still
 * render the other ten thousand.
 */
export function rowsToFiles(config: DbConfig, results: Row[][]): MappedBundle {
  const files: Record<string, string> = {};
  const diagnostics: DbDiagnostic[] = [];
  const produced: Produced[] = [];
  const directories = new Map<string, DirectoryInfo>();

  config.tables.forEach((mapping, index) => {
    const table = labelFor(mapping, index);
    const rows = results[index] ?? [];
    const jsonColumns = new Set(mapping.json ?? []);

    if (rows.length === 0) {
      diagnostics.push({
        code: 'empty-result',
        severity: 'info',
        table,
        message: `${table} returned no rows, so it contributed no documents.`,
      });
    }

    for (const row of rows) {
      const missing: string[] = [];
      const empty: string[] = [];
      let filePath = normalizeFilePath(interpolate(mapping.path, row, slug, missing, empty));
      if (missing.length > 0) {
        diagnostics.push({
          code: 'missing-column',
          severity: 'warning',
          table,
          message: `Row skipped: path "${mapping.path}" names ${missing.map((c) => `"${c}"`).join(', ')}, absent from the result.`,
        });
        continue;
      }
      // A null or punctuation-only column would leave a filename of "" -- and
      // `metrics/.md` routes nowhere useful. Better to skip and say why.
      if (empty.length > 0) {
        diagnostics.push({
          code: 'empty-path-segment',
          severity: 'warning',
          table,
          message: `Row skipped: ${empty.map((c) => `"${c}"`).join(', ')} is empty, leaving no filename in "${mapping.path}".`,
        });
        continue;
      }
      if (!filePath.endsWith('.md')) filePath += '.md';

      if (files[filePath] !== undefined) {
        diagnostics.push({
          code: 'path-collision',
          severity: 'warning',
          table,
          filePath,
          message: `Two rows both map to "${filePath}"; the first one wins.`,
        });
        continue;
      }

      let body = '';
      if (mapping.template !== undefined) {
        const templateMissing: string[] = [];
        body = interpolate(mapping.template, row, (value) => String(value ?? ''), templateMissing);
        if (templateMissing.length > 0) {
          diagnostics.push({
            code: 'missing-column',
            severity: 'warning',
            table,
            filePath,
            message: `Template names ${templateMissing.map((c) => `"${c}"`).join(', ')}, absent from the result.`,
          });
        }
      } else if (mapping.body !== undefined) {
        if (!(mapping.body in row)) {
          diagnostics.push({
            code: 'missing-column',
            severity: 'warning',
            table,
            filePath,
            message: `Body column "${mapping.body}" is absent from the result.`,
          });
        }
        body = String(row[mapping.body] ?? '');
      }

      if (body.trim() === '') {
        diagnostics.push({
          code: 'empty-body',
          severity: 'info',
          table,
          filePath,
          message: `"${filePath}" has an empty body; only its frontmatter will render.`,
        });
      }

      const title =
        mapping.title !== undefined && row[mapping.title] != null
          ? String(row[mapping.title])
          : humanize(stemOf(filePath));

      const frontmatter: Record<string, unknown> = {};
      if (mapping.type !== undefined) frontmatter.type = mapping.type;
      frontmatter.title = title;
      for (const [key, column] of Object.entries(mapping.frontmatter ?? {})) {
        let raw = row[column];
        if (jsonColumns.has(column) && typeof raw === 'string' && raw.trim() !== '') {
          try {
            raw = JSON.parse(raw) as unknown;
          } catch {
            // Keep the text rather than dropping the column: a tag list that
            // renders as a string is still visible, where a silent hole is not.
            diagnostics.push({
              code: 'invalid-json',
              severity: 'warning',
              table,
              filePath,
              message: `Column "${column}" is declared JSON but did not parse; kept as text.`,
            });
          }
        }
        const value = frontmatterValue(raw);
        if (value !== undefined) frontmatter[key] = value;
      }
      for (const [key, value] of Object.entries(mapping.constants ?? {})) {
        const normalized = frontmatterValue(value);
        if (normalized !== undefined) frontmatter[key] = normalized;
      }

      files[filePath] = serialize(frontmatter, body);
      const description = frontmatter.description;
      produced.push({
        filePath,
        title,
        ...(typeof description === 'string' && { description }),
      });
    }

    if (mapping.directory) {
      // The fixed part of the template, up to the last separator before any
      // row-dependent segment: `metrics/{name}.md` describes `metrics`.
      const literal = mapping.path.split('{')[0] ?? '';
      const cut = literal.lastIndexOf('/');
      const dir = cut === -1 ? '' : normalizeFilePath(literal.slice(0, cut));
      if (dir !== '') directories.set(dir, mapping.directory);
    }
  });

  if (config.generateIndexes !== false) {
    generateIndexes(config, files, produced, directories);
  }

  return { files, diagnostics };
}

/**
 * Synthesize the `index.md` files (SPEC §8).
 *
 * telamon can render a directory with no index, but an authored index is what
 * carries order and one-line descriptions into the sidebar -- so a generated
 * bundle that skipped them would navigate noticeably worse than a hand-written
 * one holding the same documents.
 */
function generateIndexes(
  config: DbConfig,
  files: Record<string, string>,
  produced: Produced[],
  directories: Map<string, DirectoryInfo>,
): void {
  const children = new Map<string, Set<string>>();
  const docsByDir = new Map<string, Produced[]>();

  const ensure = (dir: string) => {
    if (!children.has(dir)) children.set(dir, new Set());
    if (dir === '') return;
    const parent = dirOf(dir);
    ensure(parent);
    children.get(parent)!.add(dir);
  };

  ensure('');
  for (const doc of produced) {
    const dir = dirOf(doc.filePath);
    ensure(dir);
    const list = docsByDir.get(dir) ?? [];
    list.push(doc);
    docsByDir.set(dir, list);
  }

  for (const dir of children.keys()) {
    const filePath = dir === '' ? 'index.md' : `${dir}/index.md`;
    if (files[filePath] !== undefined) continue;

    const name = dir.slice(dir.lastIndexOf('/') + 1);
    const info = directories.get(dir);
    const heading =
      dir === '' ? (config.title ?? 'Knowledge bundle') : (info?.title ?? humanize(name));

    const lines: string[] = [`# ${heading}`, ''];

    for (const child of [...(children.get(dir) ?? [])].sort()) {
      const childName = child.slice(child.lastIndexOf('/') + 1);
      const childInfo = directories.get(child);
      const label = childInfo?.title ?? childName;
      const suffix = childInfo?.description ? ` - ${childInfo.description}` : '';
      lines.push(`* [${label}](${childName}/index.md)${suffix}`);
    }

    for (const doc of docsByDir.get(dir) ?? []) {
      const href = doc.filePath.slice(dir === '' ? 0 : dir.length + 1);
      const suffix = doc.description ? ` - ${doc.description}` : '';
      lines.push(`* [${doc.title}](${href})${suffix}`);
    }

    const body = `${lines.join('\n')}\n`;
    // Reserved files carry no frontmatter, bar `okf_version` on the root (SPEC §3.1).
    files[filePath] =
      dir === '' && config.okfVersion !== undefined
        ? `---\nokf_version: ${JSON.stringify(config.okfVersion)}\n---\n\n${body}`
        : body;
  }
}
