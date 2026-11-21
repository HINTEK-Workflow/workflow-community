import { crc32, deflateRawSync } from "node:zlib";

/**
 * A small streaming zip writer for the parted Cloud export (S4, 2026-10-23). Every entry is written whole
 * (a page of records or one attachment of at most 10 MB), so its CRC and sizes are known before its header and no
 * data descriptor is needed. Only the central directory stays in memory (about 100 bytes per entry). Zip64 records
 * are added when the archive passes 4 GB or 65 535 entries; a single entry is always below 4 GB.
 */

const LIMIT_32 = 0xffffffff;
const LIMIT_16 = 0xffff;
const UTF8_NAMES = 0x0800;

type Entry = { name: Uint8Array; crc: number; method: number; compressed: number; size: number; offset: number; zip64: boolean };

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

export function safeZipEntryName(name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(name) || name.length > 200 || name.includes(".."))
    throw new Error("Invalid zip entry name");
  return name;
}

export class ZipWriter {
  private readonly entries: Entry[] = [];
  private readonly names = new Set<string>();
  private offset = 0;
  private readonly stamp: { time: number; date: number };
  private readonly zip64Threshold: number;

  /** `zip64Threshold` is lowered only by the tests, to write the Zip64 records for a small archive. */
  constructor(options: { date?: Date; zip64Threshold?: number } = {}) {
    this.stamp = dosDateTime(options.date ?? new Date());
    this.zip64Threshold = options.zip64Threshold ?? LIMIT_32;
  }

  get bytesWritten() {
    return this.offset;
  }

  /** The bytes for one entry (its local header and its data), to be sent in order. */
  file(name: string, data: Uint8Array, options: { compress?: boolean } = {}): Uint8Array[] {
    safeZipEntryName(name);
    if (this.names.has(name)) throw new Error("Duplicate zip entry name");
    if (data.byteLength >= LIMIT_32) throw new Error("A zip entry must be smaller than 4 GB");
    this.names.add(name);
    const encodedName = new TextEncoder().encode(name);
    const deflated = options.compress && data.byteLength ? deflateRawSync(data) : null;
    const body = deflated && deflated.byteLength < data.byteLength ? new Uint8Array(deflated.buffer, deflated.byteOffset, deflated.byteLength) : data;
    const entry: Entry = {
      name: encodedName, crc: crc32(data), method: body === data ? 0 : 8, compressed: body.byteLength, size: data.byteLength,
      offset: this.offset, zip64: this.offset >= this.zip64Threshold,
    };
    const header = new Uint8Array(30 + encodedName.byteLength);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, entry.zip64 ? 45 : 20, true);
    view.setUint16(6, UTF8_NAMES, true);
    view.setUint16(8, entry.method, true);
    view.setUint16(10, this.stamp.time, true);
    view.setUint16(12, this.stamp.date, true);
    view.setUint32(14, entry.crc, true);
    view.setUint32(18, entry.compressed, true);
    view.setUint32(22, entry.size, true);
    view.setUint16(26, encodedName.byteLength, true);
    view.setUint16(28, 0, true);
    header.set(encodedName, 30);
    this.entries.push(entry);
    this.offset += header.byteLength + body.byteLength;
    return [header, body];
  }

  /** The central directory and the end records; nothing may be added afterwards. */
  finish(): Uint8Array {
    const parts: Uint8Array[] = [];
    const directoryOffset = this.offset;
    let directorySize = 0;
    for (const entry of this.entries) {
      const extra = entry.zip64 ? 12 : 0;
      const record = new Uint8Array(46 + entry.name.byteLength + extra);
      const view = new DataView(record.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 45, true);
      view.setUint16(6, entry.zip64 ? 45 : 20, true);
      view.setUint16(8, UTF8_NAMES, true);
      view.setUint16(10, entry.method, true);
      view.setUint16(12, this.stamp.time, true);
      view.setUint16(14, this.stamp.date, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.compressed, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.name.byteLength, true);
      view.setUint16(30, extra, true);
      view.setUint32(42, entry.zip64 ? LIMIT_32 : entry.offset, true);
      record.set(entry.name, 46);
      if (entry.zip64) {
        const at = 46 + entry.name.byteLength;
        view.setUint16(at, 0x0001, true);
        view.setUint16(at + 2, 8, true);
        view.setBigUint64(at + 4, BigInt(entry.offset), true);
      }
      parts.push(record);
      directorySize += record.byteLength;
    }
    const count = this.entries.length;
    const zip64 = count >= LIMIT_16 || directoryOffset >= this.zip64Threshold || directorySize >= LIMIT_32 || this.entries.some((entry) => entry.zip64);
    if (zip64) {
      const zip64End = new Uint8Array(56 + 20);
      const view = new DataView(zip64End.buffer);
      view.setUint32(0, 0x06064b50, true);
      view.setBigUint64(4, BigInt(44), true);
      view.setUint16(12, 45, true);
      view.setUint16(14, 45, true);
      view.setBigUint64(24, BigInt(count), true);
      view.setBigUint64(32, BigInt(count), true);
      view.setBigUint64(40, BigInt(directorySize), true);
      view.setBigUint64(48, BigInt(directoryOffset), true);
      // The locator points at the Zip64 end record, which starts right after the central directory.
      view.setUint32(56, 0x07064b50, true);
      view.setBigUint64(64, BigInt(directoryOffset + directorySize), true);
      view.setUint32(72, 1, true);
      parts.push(zip64End);
    }
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, zip64 ? LIMIT_16 : count, true);
    view.setUint16(10, zip64 ? LIMIT_16 : count, true);
    view.setUint32(12, zip64 ? LIMIT_32 : directorySize, true);
    view.setUint32(16, zip64 ? LIMIT_32 : directoryOffset, true);
    parts.push(end);
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const result = new Uint8Array(total);
    let at = 0;
    for (const part of parts) { result.set(part, at); at += part.byteLength; }
    this.offset += total;
    return result;
  }
}
