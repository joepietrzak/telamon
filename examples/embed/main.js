// Where the docs site is, as the reader's browser reaches it. nginx writes
// this module from DOCS_URL when the container starts; see default.conf.template.
import { DOCS_URL } from './config.js';

const api = new URL('/api/metrics', DOCS_URL);

const $ = (selector) => document.querySelector(selector);

$('#docs').src = DOCS_URL;
$('#docs-link').href = DOCS_URL;
$('#api-url').textContent = `GET ${api}`;

const integer = new Intl.NumberFormat('en');
const megabytes = (bytes) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const languages = new Intl.DisplayNames(['en'], { type: 'language' });

/** `ar` -> `Arabic`, and nothing for a directory that is not a language code. */
function languageOf(code) {
  try {
    const name = languages.of(code);
    return name === code ? '' : name;
  } catch {
    return '';
  }
}

function cell(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function directoryRow({ name, documents, bytes }, total) {
  const tr = document.createElement('tr');
  // The share of documents, drawn behind the row rather than given a column.
  tr.style.setProperty('--share', documents / total);
  tr.title = `${Math.round((documents / total) * 100)}% of documents`;

  const label = cell('th', `${name}/`);
  label.scope = 'row';
  const language = languageOf(name);
  if (language) label.append(' ', cell('span', language, 'muted'));

  tr.append(
    label,
    cell('td', integer.format(documents), 'num'),
    cell('td', megabytes(bytes), 'num'),
  );
  return tr;
}

function render(metrics) {
  const { documents, bytes, directories, countedAt } = metrics;
  $('#summary').textContent =
    `${integer.format(documents)} documents in ${directories.length} directories, ` +
    `${megabytes(bytes)} of markdown.`;

  $('#metrics tbody').replaceChildren(...directories.map((row) => directoryRow(row, documents)));

  const footer = document.createElement('tr');
  const label = cell('th', 'Total');
  label.scope = 'row';
  footer.append(
    label,
    cell('td', integer.format(documents), 'num'),
    cell('td', megabytes(bytes), 'num'),
  );
  $('#metrics tfoot').replaceChildren(footer);

  $('#counted').textContent = `· counted ${new Date(countedAt).toLocaleString()}`;
  $('#status').dataset.state = 'ok';
}

function fail(error) {
  $('#summary').textContent = `Couldn't read the docs site's API: ${error.message}.`;
  $('#metrics').hidden = true;
  $('#status').dataset.state = 'error';
}

try {
  const response = await fetch(api);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  render(await response.json());
} catch (error) {
  fail(error);
}
