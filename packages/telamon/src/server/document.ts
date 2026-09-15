/** Assembling the HTML document around a server-rendered bundle page. */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

/**
 * Make a JSON payload safe to sit inside a `<script>` element.
 *
 * `<` is escaped to its JSON unicode form, which `JSON.parse` reads back
 * identically but which cannot close the script element early -- a bundle is
 * markdown, and markdown contains `</script>` sooner or later.
 */
/**
 * The two Unicode line separators, built from their code points rather than
 * written literally: they are line terminators in source too, and a regular
 * expression containing one does not survive the parser.
 */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const SEPARATORS = new RegExp(`[${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, 'g');

export function escapeJsonForScript(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(SEPARATORS, (char) => (char === LINE_SEPARATOR ? '\\u2028' : '\\u2029'));
}

export interface DocumentOptions {
  title: string;
  body: string;
  lang: string;
  stylesheets: string[];
  /** Settings and the script that reads them. Omitted when enhancement is off. */
  enhancement?: { payload: string; src: string; scriptId: string };
  rootId: string;
  head?: string;
}

export function renderDocument(options: DocumentOptions): string {
  const { title, body, lang, stylesheets, enhancement, rootId, head } = options;

  const links = stylesheets
    .map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
    .join('\n    ');

  const scripts = enhancement
    ? `\n    <script id="${enhancement.scriptId}" type="application/json">${escapeJsonForScript(enhancement.payload)}</script>` +
      `\n    <script type="module" src="${escapeHtml(enhancement.src)}" defer></script>`
    : '';

  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    ${links}${head ? `\n    ${head}` : ''}
  </head>
  <body>
    <div id="${escapeHtml(rootId)}">${body}</div>${scripts}
  </body>
</html>
`;
}
