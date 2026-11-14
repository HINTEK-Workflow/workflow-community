import assert from "node:assert/strict";
import { crc32, inflateRawSync } from "node:zlib";

/** A small independent zip reader: the end record (or Zip64's), the central directory and each local header. */
export function readZip(bytes: Buffer) {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end -= 1;
  assert.ok(end >= 0, "end of central directory");
  let count = bytes.readUInt16LE(end + 10);
  let directoryOffset = bytes.readUInt32LE(end + 16);
  let zip64 = false;
  if (count === 0xffff || directoryOffset === 0xffffffff) {
    const locator = end - 20;
    assert.equal(bytes.readUInt32LE(locator), 0x07064b50, "Zip64 locator");
    const record = Number(bytes.readBigUInt64LE(locator + 8));
    assert.equal(bytes.readUInt32LE(record), 0x06064b50, "Zip64 end record");
    count = Number(bytes.readBigUInt64LE(record + 32));
    directoryOffset = Number(bytes.readBigUInt64LE(record + 48));
    zip64 = true;
  }
  const files = new Map<string, Buffer>();
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50, "central directory header");
    const method = bytes.readUInt16LE(at + 10);
    const crc = bytes.readUInt32LE(at + 16);
    const compressed = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    let offset = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    if (offset === 0xffffffff) {
      const extra = at + 46 + nameLength;
      assert.equal(bytes.readUInt16LE(extra), 0x0001);
      offset = Number(bytes.readBigUInt64LE(extra + 4));
    }
    assert.equal(bytes.readUInt32LE(offset), 0x04034b50, `local header of ${name}`);
    const localName = bytes.readUInt16LE(offset + 26);
    const localExtra = bytes.readUInt16LE(offset + 28);
    const body = bytes.subarray(offset + 30 + localName + localExtra, offset + 30 + localName + localExtra + compressed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, size, name);
    assert.equal(crc32(data), crc, `CRC of ${name}`);
    files.set(name, data);
    at += 46 + nameLength + extraLength;
  }
  return { files, zip64 };
}
