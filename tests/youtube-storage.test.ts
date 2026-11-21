import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Filmer (2026-11-20): the films' storage, in a folder of this test file only (env is read when lib/env is first imported, so
// nothing else is imported before it is set).
const dir = mkdtempSync(path.join(tmpdir(), "wf-youtube-"));
process.env.STORAGE_ROOT = dir;
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

test("the storage: pieces in order, the first bytes decide, the limit holds, and no path leaves the company's folder", async (t) => {
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { env } = await import("../lib/env");
  assert.equal(path.resolve(env.STORAGE_ROOT), path.resolve(dir), "the test's own folder");
  const { storeVideoChunk, readVideoPiece, removeStored, storeThumbnail, readThumbnail } = await import("../lib/youtube/storage");
  const org = "cmorganization0001";
  const mp4 = new Uint8Array(100).fill(1);
  mp4.set([0, 0, 0, 0x18, ...ascii("ftypisom")], 0);
  const one = await storeVideoChunk(org, { upload: "", offset: 0, total: 100, bytes: mp4.subarray(0, 60), maxBytes: 1000 });
  assert.equal(one.done, false);
  if (one.done) return;
  await assert.rejects(storeVideoChunk(org, { upload: one.upload, offset: 10, total: 100, bytes: mp4.subarray(60), maxBytes: 1000 }), /avbröts/, "a piece must start where the part ends");
  const two = await storeVideoChunk(org, { upload: one.upload, offset: 60, total: 100, bytes: mp4.subarray(60), maxBytes: 1000 });
  assert.equal(two.done, true);
  if (!two.done) return;
  assert.match(two.key, /^[a-f0-9-]{36}\.mp4$/);
  assert.equal(two.type, "video/mp4");
  assert.deepEqual([...(await readVideoPiece(org, two.key, 0, 12))], [...mp4.subarray(0, 12)]);
  await assert.rejects(storeVideoChunk(org, { upload: "", offset: 0, total: 100, bytes: new Uint8Array(100).fill(9), maxBytes: 1000 }), /ingen film/, "refused at the first piece");
  await assert.rejects(storeVideoChunk(org, { upload: "", offset: 0, total: 5000, bytes: mp4, maxBytes: 1000 }), /taket/);
  await assert.rejects(readVideoPiece(org, "../../etc/passwd", 0, 1), /finns inte/);
  await assert.rejects(readVideoPiece("../other", two.key, 0, 1), /Okänt företag/);
  await assert.rejects(storeThumbnail(org, new Uint8Array([1, 2, 3])), /JPEG- eller PNG/);
  const picture = await storeThumbnail(org, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]));
  assert.equal((await readThumbnail(org, picture.key))?.type, "image/jpeg");
  assert.equal(await readThumbnail("cmorganization0002", picture.key), null, "another company never reads it");
  await removeStored(org, two.key);
  await assert.rejects(readVideoPiece(org, two.key, 0, 1));
});
