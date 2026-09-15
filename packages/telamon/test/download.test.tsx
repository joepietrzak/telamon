import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OkfSite,
  archiveFileName,
  createMemoryRouter,
  zipFiles,
  type OkfSiteProps,
} from '../src/index.js';
import { readFixture } from './helpers.js';

const demo = readFixture('demo');

afterEach(cleanup);

/* -------------------------------------------------------------- zip reading */

/**
 * CRC-32 the slow way, bit by bit. Deliberately not the table-driven form the
 * writer uses, so agreement between the two means something.
 */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Read an archive the way a real unzip does: find the end-of-central-directory
 * record, walk the central directory, and follow each entry's offset to its
 * local header. Nothing here trusts the order or the layout the writer chose.
 */
function readZip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();

  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  expect(view.getUint16(end + 8, true)).toBe(count);

  const files = new Map<string, string>();
  let at = centralOffset;
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const uncompressed = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    expect(view.getUint16(localOffset + 8, true)).toBe(0); // stored
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(start, start + compressed);

    expect(data.length).toBe(uncompressed);
    expect(crc32(data)).toBe(crc);
    files.set(name, decoder.decode(data));

    at += 46 + nameLength + extraLength + commentLength;
  }
  expect(at - centralOffset).toBe(centralSize);
  return files;
}

/* ------------------------------------------------------------------ the zip */

describe('zipFiles', () => {
  const modified = new Date('2026-08-14T11:02:00Z');

  it('round-trips every file in a bundle', () => {
    const archive = readZip(zipFiles(demo, { modified }));
    expect(archive.size).toBe(Object.keys(demo).length);
    for (const [path, contents] of Object.entries(demo)) {
      expect(archive.get(path)).toBe(contents);
    }
  });

  it('keeps nested paths and frontmatter verbatim', () => {
    const archive = readZip(zipFiles(demo, { modified }));
    expect(archive.get('metrics/gross_revenue.md')).toContain('type: Metric');
    expect(archive.get('metrics/gross_revenue.md')).toBe(demo['metrics/gross_revenue.md']);
  });

  it('survives non-ASCII names and contents', () => {
    const archive = readZip(
      zipFiles({ 'métriques/chiffre-d’affaires.md': '# Chiffre d’affaires — 90 %' }, { modified }),
    );
    expect(archive.get('métriques/chiffre-d’affaires.md')).toBe('# Chiffre d’affaires — 90 %');
  });

  it('writes entries in sorted order, so the same bundle gives the same bytes', () => {
    const scrambled = Object.fromEntries(Object.entries(demo).reverse());
    expect(zipFiles(scrambled, { modified })).toEqual(zipFiles(demo, { modified }));
    expect([...readZip(zipFiles(demo, { modified })).keys()]).toEqual(
      Object.keys(demo).sort(),
    );
  });

  it('writes a valid empty archive', () => {
    expect(readZip(zipFiles({}, { modified })).size).toBe(0);
  });

  it('pins a pre-1980 or invalid timestamp to the DOS epoch', () => {
    expect(() => readZip(zipFiles(demo, { modified: new Date('1970-01-01') }))).not.toThrow();
    expect(() => readZip(zipFiles(demo, { modified: new Date('nonsense') }))).not.toThrow();
  });
});

describe('archiveFileName', () => {
  it('slugs a title', () => {
    expect(archiveFileName('Acme metrics')).toBe('acme-metrics.zip');
    expect(archiveFileName('GA4 — sample e-commerce')).toBe('ga4-sample-e-commerce.zip');
  });

  it('falls back when a title slugs away to nothing', () => {
    expect(archiveFileName('—')).toBe('okf-bundle.zip');
    expect(archiveFileName('')).toBe('okf-bundle.zip');
  });
});

/* ------------------------------------------------------------ the button */

/** jsdom's Blob implements neither `arrayBuffer` nor `text`, but FileReader reads it. */
function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function renderSite({ route = '/', ...props }: Partial<OkfSiteProps> & { route?: string } = {}) {
  const router = createMemoryRouter(route);
  render(<OkfSite bundle={demo} router={router} {...props} />);
  return { user: userEvent.setup() };
}

describe('the download button', () => {
  let saved: { blob: Blob | undefined; name: string | undefined };

  beforeEach(() => {
    saved = { blob: undefined, name: undefined };
    // jsdom implements neither, and an anchor click must not navigate the test.
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved.blob = blob;
      return 'blob:okf';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.name = this.download;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers the bundle source from the header', async () => {
    const { user } = renderSite({ title: 'Acme metrics' });
    await user.click(screen.getByRole('button', { name: 'Download' }));

    expect(saved.name).toBe('acme-metrics.zip');
    expect(saved.blob?.type).toBe('application/zip');

    const archive = readZip(await blobBytes(saved.blob!));
    expect(archive.get('metrics/gross_revenue.md')).toBe(demo['metrics/gross_revenue.md']);
    expect(archive.size).toBe(Object.keys(demo).length);
  });

  it('falls back to the site title when none is supplied', async () => {
    // No `title` prop and no frontmatter title on the demo root, so the site
    // title -- and the archive name with it -- comes from its first heading.
    const { user } = renderSite();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(saved.name).toBe('subdirectories.zip');
  });

  it('releases the object URL once the click is through', async () => {
    const { user } = renderSite();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:okf'));
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('can be switched off', () => {
    renderSite({ features: { download: false } });
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('can be replaced through the slot', () => {
    renderSite({ components: { Download: () => <button type="button">Export</button> } });
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });
});
