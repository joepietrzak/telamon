/**
 * A minimal ZIP writer, so a bundle can be handed back as the files it came from.
 *
 * Entries are stored, never deflated: an OKF bundle is markdown that the host
 * almost always serves compressed anyway, and `CompressionStream` is neither
 * synchronous nor available everywhere this library runs. Storing keeps the
 * writer a hundred lines with no dependency and no async seam.
 *
 * The format written is the original (non-Zip64) one, which caps an archive at
 * 65,535 entries and 4 GiB per file. A knowledge bundle is nowhere near either.
 */

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_OF_CENTRAL_DIRECTORY = 22;

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;

/** Names are written as UTF-8, which bit 11 of the general purpose flag declares. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;
/** 2.0, the floor for a reader that understands directories and UTF-8 names. */
const VERSION = 20;

let table: Uint32Array | undefined;

function crcTable(): Uint32Array {
  if (table) return table;
  const next = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    next[i] = c >>> 0;
  }
  table = next;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const lookup = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = lookup[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, the only timestamp the base format carries. */
function dosStamp(when: Date): { time: number; date: number } {
  // The epoch is 1980; anything earlier, or an invalid date, pins to it.
  const valid = Number.isNaN(when.getTime()) ? new Date(1980, 0, 1) : when;
  const year = valid.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (valid.getHours() << 11) | (valid.getMinutes() << 5) | (valid.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((valid.getMonth() + 1) << 5) | valid.getDate(),
  };
}

export interface ZipOptions {
  /** Modification time recorded for every entry. Defaults to now. */
  modified?: Date;
}

/**
 * Pack a map of path to contents into a stored ZIP archive.
 *
 * Paths are written in sorted order so the same bundle always produces the
 * same bytes, given the same timestamp.
 */
export function zipFiles(
  files: Record<string, string>,
  options: ZipOptions = {},
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const stamp = dosStamp(options.modified ?? new Date());

  const entries: { name: Uint8Array; data: Uint8Array; crc: number; offset: number }[] = [];
  let offset = 0;
  for (const path of Object.keys(files).sort()) {
    const name = encoder.encode(path);
    const data = encoder.encode(files[path]!);
    entries.push({ name, data, crc: crc32(data), offset });
    offset += LOCAL_HEADER + name.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = entries.reduce((sum, e) => sum + CENTRAL_HEADER + e.name.length, 0);
  const out = new Uint8Array(centralOffset + centralSize + END_OF_CENTRAL_DIRECTORY);
  const view = new DataView(out.buffer);

  for (const entry of entries) {
    let at = entry.offset;
    view.setUint32(at, LOCAL_SIGNATURE, true);
    view.setUint16(at + 4, VERSION, true);
    view.setUint16(at + 6, FLAG_UTF8, true);
    view.setUint16(at + 8, METHOD_STORED, true);
    view.setUint16(at + 10, stamp.time, true);
    view.setUint16(at + 12, stamp.date, true);
    view.setUint32(at + 14, entry.crc, true);
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint32(at + 22, entry.data.length, true);
    view.setUint16(at + 26, entry.name.length, true);
    view.setUint16(at + 28, 0, true);
    at += LOCAL_HEADER;
    out.set(entry.name, at);
    out.set(entry.data, at + entry.name.length);
  }

  let at = centralOffset;
  for (const entry of entries) {
    view.setUint32(at, CENTRAL_SIGNATURE, true);
    view.setUint16(at + 4, VERSION, true);
    view.setUint16(at + 6, VERSION, true);
    view.setUint16(at + 8, FLAG_UTF8, true);
    view.setUint16(at + 10, METHOD_STORED, true);
    view.setUint16(at + 12, stamp.time, true);
    view.setUint16(at + 14, stamp.date, true);
    view.setUint32(at + 16, entry.crc, true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint32(at + 24, entry.data.length, true);
    view.setUint16(at + 28, entry.name.length, true);
    view.setUint16(at + 30, 0, true); // extra field
    view.setUint16(at + 32, 0, true); // comment
    view.setUint16(at + 34, 0, true); // disk number
    view.setUint16(at + 36, 0, true); // internal attributes
    view.setUint32(at + 38, 0, true); // external attributes
    view.setUint32(at + 42, entry.offset, true);
    at += CENTRAL_HEADER;
    out.set(entry.name, at);
    at += entry.name.length;
  }

  view.setUint32(at, END_SIGNATURE, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, centralSize, true);
  view.setUint32(at + 16, centralOffset, true);
  view.setUint16(at + 20, 0, true);

  return out;
}

/** `Acme metrics` -> `acme-metrics.zip`, with a fallback for a title that slugs away. */
export function archiveFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${slug || 'okf-bundle'}.zip`;
}
