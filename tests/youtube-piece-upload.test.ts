import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { VIDEO_CHUNK_BYTES, type VideoView } from "../lib/youtube/model";

// Filmer (2026-11-25): the film's way to our own server is as robust as the landing page's films since 0.85.0 – pieces of 2 MB as the
// raw body, a piece sent again is harmless, a gap is a 409 with how much the server has, a lost answer is asked about, a piece that
// never answers is sent again, and the stale parts are swept in the background.

// The films' folder for this test file only (env is read when storage.ts is first imported).
const storage = mkdtempSync(path.join(tmpdir(), "youtube-piece-upload-"));
process.env.STORAGE_ROOT = storage;
const store = () => import("../lib/youtube/storage");
const client = () => import("../lib/youtube/piece-upload");
const ORG = "orgtest-piece-0001";
const folder = path.join(storage, "youtube-videos", ORG);
const MAX = 50 * 1024 * 1024;

/** A film of `size` bytes that starts like an mp4, with bytes that differ from place to place. */
function mp4(size: number) {
  const bytes = new Uint8Array(size);
  for (let at = 0; at < size; at += 1) bytes[at] = (at * 7 + (at >> 11)) % 251;
  bytes.set([0, 0, 0, 0x20, ...Buffer.from("ftypisom")]);
  return bytes;
}
const stored = (key: string) => new Uint8Array(readFileSync(path.join(folder, key)));
const refused = (status: number, received?: number) => (error: unknown) => {
  const failure = error as { status?: number; received?: number };
  assert.equal(failure.status, status);
  if (received !== undefined) assert.equal(failure.received, received);
  return true;
};

test("the server: a piece sent again is harmless, a gap gets 409 with how much is there, and the state can be asked", async () => {
  const { storeVideoChunk, videoUploadReceived } = await store();
  const file = mp4(3000);
  const piece = (upload: string, from: number, to: number) => storeVideoChunk(ORG, { upload, offset: from, total: file.length, bytes: file.subarray(from, to), maxBytes: MAX });
  const first = await piece("", 0, 1000);
  assert.ok(!first.done && first.received === 1000);
  const upload = first.done ? "" : first.upload;
  await assert.rejects(piece(upload, 2000, 3000), refused(409, 1000));
  await piece(upload, 1000, 2000);
  assert.deepEqual(await piece(upload, 1000, 2000), { done: false, upload, received: 2000 }, "the same piece once more");
  assert.equal(await videoUploadReceived(ORG, upload), 2000);
  const last = await piece(upload, 2000, 3000);
  assert.ok(last.done && last.kind === "mp4" && last.size === 3000);
  assert.deepEqual(stored(last.done ? last.key : ""), file, "the film is whole, nothing twice");
  const gone = "0a1b2c3d-0000-4000-8000-00000000dead";
  await assert.rejects(videoUploadReceived(ORG, gone), refused(404, 0));
  await assert.rejects(piece(gone, 1000, 2000), refused(404, 0));
  await assert.rejects(videoUploadReceived(ORG, "../../etc/passwd"), refused(400));
  await assert.rejects(storeVideoChunk(ORG, { upload: "", offset: 0, total: 2000, bytes: new TextEncoder().encode("<html><body>".repeat(20)), maxBytes: MAX }), /ingen film/);
  await assert.rejects(storeVideoChunk(ORG, { upload: "", offset: 0, total: VIDEO_CHUNK_BYTES + 2, bytes: mp4(VIDEO_CHUNK_BYTES + 1), maxBytes: MAX }), /gick inte ihop/, "a piece over 2 MB");
});

test("the server: a piece sent again while the first try still writes waits for it", async () => {
  const { storeVideoChunk } = await store();
  const file = mp4(4000);
  const first = await storeVideoChunk(ORG, { upload: "", offset: 0, total: file.length, bytes: file.subarray(0, 2000), maxBytes: MAX });
  const upload = first.done ? "" : first.upload;
  const [one, two] = await Promise.allSettled([1, 2].map(() => storeVideoChunk(ORG, { upload, offset: 2000, total: file.length, bytes: file.subarray(2000), maxBytes: MAX })));
  // The first finishes the film; the second finds the part gone (videos-server answers it as finished, by the film's key).
  assert.ok(one.status === "fulfilled" && one.value.done);
  assert.ok(two.status === "rejected" && (two.reason as { status: number }).status === 404);
  assert.deepEqual(stored(one.status === "fulfilled" && one.value.done ? one.value.key : ""), file);
});

test("the stale parts are swept in the background at most every ten minutes", async () => {
  const { sweepStaleParts, STALE_SWEEP_INTERVAL_MS } = await store();
  const dir = path.join(storage, "youtube-videos", "orgtest-sweep-0001");
  mkdirSync(dir, { recursive: true });
  const old = path.join(dir, "0a1b2c3d-0000-4000-8000-0000000000aa.part");
  const fresh = path.join(dir, "0a1b2c3d-0000-4000-8000-0000000000bb.part");
  writeFileSync(old, "x"); writeFileSync(fresh, "x");
  const twoDaysAgo = (Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(old, twoDaysAgo, twoDaysAgo);
  const now = Date.now();
  const sweep = sweepStaleParts(dir, now);
  assert.ok(sweep, "the first sweep");
  assert.equal(sweepStaleParts(dir, now + 1000), null, "only one at a time");
  await sweep;
  assert.equal(sweepStaleParts(dir, now + 60_000), null, "and not again within ten minutes");
  assert.ok(sweepStaleParts(dir, now + STALE_SWEEP_INTERVAL_MS + 1), "but after them");
  const left = readdirSync(dir);
  assert.ok(!left.includes(path.basename(old)), "the day-old part is removed");
  assert.ok(left.includes(path.basename(fresh)), "the upload in progress stays");
});

type Trouble = "lose-answer" | "fail-before" | "hang" | undefined;
/**
 * The server as the page meets it (lib/api-handlers/youtube-videos.ts and videos-server.ts): the same answers and errors as api()
 * gives, a finished upload answered by its key, and the network's troubles put in by `trouble`.
 */
async function server(trouble: (call: { method: string; offset: number; n: number }) => Trouble) {
  const { storeVideoChunk, videoUploadReceived, VideoStoreError } = await store();
  const calls: { method: string; offset: number }[] = [];
  const finished = new Map<string, string>();
  const view = (key: string) => ({ id: "film", file: { name: "film.mp4", ready: true, upload: null, key } }) as unknown as VideoView;
  const request = async (url: string, init: RequestInit) => {
    const query = new URL(url, "http://localhost").searchParams;
    const method = init.method ?? "GET";
    const offset = Number(query.get("offset") ?? -1);
    calls.push({ method, offset });
    assert.equal(query.get("id"), "film");
    const what = trouble({ method, offset, n: calls.length });
    if (what === "hang") return new Promise<never>((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("Ingen kontakt med servern."), { status: 0, details: {} }))));
    if (what === "fail-before") throw Object.assign(new Error("Servern svarar inte just nu."), { status: 504, details: {} });
    const upload = query.get("upload") ?? "";
    try {
      let answer;
      if (finished.has(upload)) answer = { done: true, video: view(finished.get(upload)!) };
      else if (method === "GET") answer = { done: false, upload, received: await videoUploadReceived(ORG, upload) };
      else {
        assert.equal((init.headers as Record<string, string>)["Content-Type"], "application/octet-stream");
        const result = await storeVideoChunk(ORG, { upload, offset, total: Number(query.get("total")), bytes: new Uint8Array(await (init.body as Blob).arrayBuffer()), maxBytes: MAX });
        if (result.done) { finished.set(result.key.split(".")[0], result.key); answer = { done: true, video: view(result.key) }; }
        else answer = result;
      }
      if (what === "lose-answer") throw Object.assign(new Error("Servern svarar inte just nu."), { status: 504, details: {} });
      return answer;
    } catch (error) {
      if (error instanceof VideoStoreError) throw Object.assign(new Error(error.message), { status: error.status, details: error.received === undefined ? {} : { received: error.received } });
      throw error;
    }
  };
  return { request, calls };
}
const keyOf = (video: VideoView) => (video.file as unknown as { key: string }).key;
const noWait = async () => undefined;

test("the page: a lost answer is asked about and the upload goes on from where the server is, without sending a piece twice", async () => {
  const { uploadVideoFile, VIDEO_RETRY_NOTICE } = await client();
  const file = mp4(3 * VIDEO_CHUNK_BYTES + 500);
  const { request, calls } = await server(({ method, offset }) => (method === "POST" && offset === VIDEO_CHUNK_BYTES && !calls.some((call) => call.method === "GET") ? "lose-answer" : undefined));
  const notices: string[] = [];
  const shares: number[] = [];
  const waits: number[] = [];
  const video = await uploadVideoFile("film", new Blob([file]), { request, wait: async (ms) => { waits.push(ms); } }, { progress: (share) => shares.push(share), notice: (text) => notices.push(text) });
  assert.deepEqual(stored(keyOf(video)), file);
  assert.deepEqual(calls.map((call) => call.method === "GET" ? "GET" : call.offset / VIDEO_CHUNK_BYTES), [0, 1, "GET", 2, 3], "the lost piece is not sent again");
  assert.ok(notices.includes(VIDEO_RETRY_NOTICE));
  assert.equal(notices.at(-1), "");
  assert.deepEqual(waits, [1000]);
  assert.equal(shares.at(-1), 1);
  assert.ok(shares.every((share, index) => index === 0 || share >= shares[index - 1]), "the progress never goes back");
});

test("the page: the last piece's answer lost is answered with the film; a piece that never answers is sent again", async () => {
  const { uploadVideoFile } = await client();
  const file = mp4(VIDEO_CHUNK_BYTES + 100);
  let lost = false;
  const last = await server(({ method, offset }) => (method === "POST" && offset === VIDEO_CHUNK_BYTES && !lost ? ((lost = true), "lose-answer") : undefined));
  const video = await uploadVideoFile("film", new Blob([file]), { request: last.request, wait: noWait });
  assert.deepEqual(stored(keyOf(video)), file);
  assert.deepEqual(last.calls.map((call) => call.method), ["POST", "POST", "GET"], "the question after the lost answer gives the film");
  const slow = await server(({ n }) => (n === 1 ? "hang" : undefined));
  const again = await uploadVideoFile("film", new Blob([file]), { request: slow.request, wait: noWait, timeoutMs: 30 });
  assert.deepEqual(stored(keyOf(again)), file);
  assert.equal(slow.calls.filter((call) => call.method === "POST" && call.offset === 0).length, 2, "the hanging first piece was sent again");
});

test("the page: five tries with backoff, then a plain message; a refusal is not tried again; a 409 goes on from the server's amount", async () => {
  const { uploadVideoFile, VIDEO_UPLOAD_GAVE_UP } = await client();
  const file = mp4(2 * VIDEO_CHUNK_BYTES + 10);
  const waits: number[] = [];
  const notices: string[] = [];
  const down = await server(() => "fail-before");
  await assert.rejects(uploadVideoFile("film", new Blob([file]), { request: down.request, wait: async (ms) => { waits.push(ms); } }, { notice: (text) => notices.push(text) }), new RegExp(VIDEO_UPLOAD_GAVE_UP.slice(0, 30)));
  assert.equal(down.calls.length, 6, "the first try and five more");
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 15_000]);
  assert.equal(notices.at(-1), "");
  const html = await server(() => undefined);
  await assert.rejects(uploadVideoFile("film", new Blob(["<html><body>".repeat(20)]), { request: html.request, wait: noWait }), /ingen film/);
  assert.equal(html.calls.length, 1, "the wrong kind of file is told at once");
  const short = await server(() => undefined);
  let cut = false;
  const request = async (url: string, init: RequestInit) => {
    const answer = await short.request(url, init) as { done: boolean; upload?: string; received?: number };
    if (!cut && answer.upload && answer.received === VIDEO_CHUNK_BYTES) { cut = true; return { ...answer, received: VIDEO_CHUNK_BYTES + 5 }; }
    return answer;
  };
  const video = await uploadVideoFile("film", new Blob([file]), { request, wait: noWait });
  assert.deepEqual(stored(keyOf(video)), file, "it went on from the server's amount");
  assert.deepEqual(short.calls.map((call) => call.offset), [0, VIDEO_CHUNK_BYTES + 5, VIDEO_CHUNK_BYTES, 2 * VIDEO_CHUNK_BYTES]);
});

test("the page: an upload the server lost starts over, and Avbryt stops between pieces", async () => {
  const { uploadVideoFile, VIDEO_UPLOAD_STOPPED } = await client();
  const file = mp4(VIDEO_CHUNK_BYTES + 50);
  let lostOnce = false;
  const lost = await server(({ method, offset }) => {
    if (method === "POST" && offset === VIDEO_CHUNK_BYTES && !lostOnce) {
      lostOnce = true;
      for (const name of readdirSync(folder)) if (name.endsWith(".part")) rmSync(path.join(folder, name));
      return "fail-before";
    }
    return undefined;
  });
  const video = await uploadVideoFile("film", new Blob([file]), { request: lost.request, wait: noWait });
  assert.deepEqual(stored(keyOf(video)), file);
  assert.deepEqual(lost.calls.map((call) => call.method === "GET" ? "GET" : call.offset), [0, VIDEO_CHUNK_BYTES, "GET", 0, VIDEO_CHUNK_BYTES]);
  let sent = 0;
  const counting = await server(() => { sent += 1; return undefined; });
  await assert.rejects(uploadVideoFile("film", new Blob([file]), { request: counting.request, wait: noWait }, { stopped: () => sent >= 1 }), new RegExp(VIDEO_UPLOAD_STOPPED));
  assert.equal(sent, 1);
});
