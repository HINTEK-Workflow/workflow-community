import path from "node:path";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { imageKindOf, THUMBNAIL_MAX_BYTES, VIDEO_CHUNK_BYTES, VIDEO_TYPES, videoKindOf, type VideoFileKind } from "./model";

/**
 * Filmer (2026-11-20): the films and their cover pictures in the installation's own file storage (STORAGE_ROOT/youtube-videos/
 * <company>/, the same storage as the documents and the landing page's films), never in Git, the image or the database. Each
 * company has its own folder; a name is random and checked by its pattern before it is used, so no path can leave the folder.
 *
 * A film comes in pieces of 2 MB (as the landing page's films, ee/landing/films.ts): the first piece starts an upload, and when
 * the last piece is in the file is checked by its first bytes (MP4, MOV or WebM) before it gets its name. A part never finished is
 * removed after a day.
 *
 * Robust upload (2026-11-25, the same as the landing page's films since 0.85.0): each piece is written at its own place in the
 * part, so a piece sent again after a lost answer writes the same bytes once more instead of failing; a piece after a gap is
 * refused (409) with how much the server has, and the page goes on from there; one upload's pieces never write at the same time;
 * the stale parts are swept in the background at most every ten minutes, never while a piece waits for its answer.
 */
const ORG = /^[A-Za-z0-9_-]{8,40}$/;
export const UPLOAD_ID = /^[a-f0-9-]{36}$/;
export const VIDEO_KEY = /^[a-f0-9-]{36}\.(mp4|mov|webm)$/;
export const THUMBNAIL_KEY = /^[a-f0-9-]{36}\.(jpg|png)$/;
const STALE_PART_MS = 24 * 60 * 60 * 1000;
/** Stale parts are looked for at most this often per company folder, in the background. */
export const STALE_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/** `received`: how much of the upload the server has, so the page can go on from there (a 409 or a 404). */
export class VideoStoreError extends Error {
  constructor(readonly status: number, message: string, readonly received?: number) { super(message); }
}

function folder(organizationId: string) {
  if (!ORG.test(organizationId)) throw new VideoStoreError(400, "Okänt företag.");
  return path.resolve(env.STORAGE_ROOT, "youtube-videos", organizationId);
}
function fileOf(organizationId: string, key: string, pattern: RegExp) {
  if (!pattern.test(key)) throw new VideoStoreError(404, "Filen finns inte.");
  return path.join(folder(organizationId), key);
}

async function removeStaleParts(dir: string) {
  try {
    const now = Date.now();
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".part")) continue;
      const info = await stat(path.join(dir, name)).catch(() => null);
      if (info && now - info.mtimeMs > STALE_PART_MS) await rm(path.join(dir, name), { force: true });
    }
  } catch { /* no folder yet */ }
}

export type VideoChunk = { upload: string; offset: number; total: number; bytes: Uint8Array; maxBytes: number };
export type VideoChunkResult = { done: false; upload: string; received: number } | { done: true; key: string; kind: VideoFileKind; type: string; size: number };

/** The last sweep per company folder, and the one running. */
const sweeps = new Map<string, { at: number; running: Promise<void> | null }>();
/** Sweeps the folder's stale parts at most every ten minutes and never awaited by a piece (the tests await what it returns). */
export function sweepStaleParts(dir: string, now = Date.now()): Promise<void> | null {
  const last = sweeps.get(dir);
  if (last?.running || (last && now - last.at < STALE_SWEEP_INTERVAL_MS)) return null;
  const entry: { at: number; running: Promise<void> | null } = { at: now, running: null };
  entry.running = removeStaleParts(dir).finally(() => { entry.running = null; });
  sweeps.set(dir, entry);
  return entry.running;
}

/** One upload's pieces are handled one at a time: a piece sent again while the first try still writes waits for it. */
const queues = new Map<string, Promise<unknown>>();
function oneAtATime<T>(id: string, work: () => Promise<T>): Promise<T> {
  const before = queues.get(id) ?? Promise.resolve();
  const run = before.catch(() => undefined).then(work);
  const settled = run.catch(() => undefined);
  queues.set(id, settled);
  void settled.then(() => { if (queues.get(id) === settled) queues.delete(id); });
  return run;
}

const MISSING = "Uppladdningen finns inte längre på servern. Börja om.";
const MISMATCH = "Uppladdningen gick inte ihop. Försök igen.";

/**
 * One piece of a film. The first piece (offset 0, no upload id) starts a new upload. Each following piece is written at its own
 * place and may start anywhere up to where the part ends; a piece after a gap is refused (409) with how much the server has, and an
 * upload the server no longer has is a 404 (the page starts over). Every file operation is asynchronous.
 */
export async function storeVideoChunk(organizationId: string, { upload, offset, total, bytes, maxBytes }: VideoChunk): Promise<VideoChunkResult> {
  if (!Number.isInteger(total) || total <= 0) throw new VideoStoreError(400, "Filen är tom.");
  if (total > maxBytes) throw new VideoStoreError(413, `Filmen är större än ${Math.round(maxBytes / 1024 / 1024)} MB, som är taket i den här installationen.`);
  if (!Number.isInteger(offset) || offset < 0 || bytes.byteLength === 0 || bytes.byteLength > VIDEO_CHUNK_BYTES || offset + bytes.byteLength > total)
    throw new VideoStoreError(400, MISMATCH);
  const dir = folder(organizationId);
  void sweepStaleParts(dir)?.catch(() => undefined);
  if (offset === 0 && !upload) {
    // The first bytes say at once whether it is a film, so a wrong file stops before gigabytes are sent.
    if (!videoKindOf(bytes.subarray(0, 64))) throw new VideoStoreError(400, "Filen är ingen film i formatet MP4, MOV eller WebM.");
    await mkdir(dir, { recursive: true });
    const id = randomUUID();
    const handle = await open(path.join(dir, `${id}.part`), "wx", 0o640);
    try { await handle.write(bytes, 0, bytes.byteLength, 0); } finally { await handle.close(); }
    return bytes.byteLength < total ? { done: false, upload: id, received: bytes.byteLength } : finish(dir, id, total);
  }
  if (!UPLOAD_ID.test(upload)) throw new VideoStoreError(400, MISMATCH);
  return oneAtATime(`${organizationId}/${upload}`, async () => {
    const part = path.join(dir, `${upload}.part`);
    const info = await stat(part).catch(() => null);
    if (!info) throw new VideoStoreError(404, MISSING, 0);
    if (offset > info.size) throw new VideoStoreError(409, "Uppladdningen hoppade över en del. Fortsätter där servern är.", info.size);
    const handle = await open(part, "r+");
    try { await handle.write(bytes, 0, bytes.byteLength, offset); } finally { await handle.close(); }
    const received = Math.max(info.size, offset + bytes.byteLength);
    return received < total ? { done: false, upload, received } : finish(dir, upload, total);
  });
}

/** How far an upload has come: the bytes stored so far; a part the server no longer has is a 404 (the caller knows a finished one). */
export async function videoUploadReceived(organizationId: string, upload: string): Promise<number> {
  if (!UPLOAD_ID.test(upload)) throw new VideoStoreError(400, MISMATCH);
  const info = await stat(path.join(folder(organizationId), `${upload}.part`)).catch(() => null);
  if (!info) throw new VideoStoreError(404, MISSING, 0);
  return info.size;
}

/** The whole film is in: checked by its first bytes before it gets its name. */
async function finish(dir: string, id: string, total: number): Promise<VideoChunkResult> {
  const part = path.join(dir, `${id}.part`);
  const info = await stat(part);
  if (info.size !== total) {
    await rm(part, { force: true });
    throw new VideoStoreError(400, MISMATCH);
  }
  const head = await readPart(part, 0, 64);
  const kind = videoKindOf(head);
  if (!kind) {
    await rm(part, { force: true });
    throw new VideoStoreError(400, "Filen är ingen film i formatet MP4, MOV eller WebM.");
  }
  const key = `${id}.${kind}`;
  await rename(part, path.join(dir, key));
  return { done: true, key, kind, type: VIDEO_TYPES[kind], size: total };
}

async function readPart(file: string, start: number, length: number): Promise<Uint8Array> {
  const handle = await open(file, "r");
  try {
    const buffer = new Uint8Array(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

/** `length` bytes of a stored film from `start` (the upload to YouTube reads one piece at a time). */
export async function readVideoPiece(organizationId: string, key: string, start: number, length: number): Promise<Uint8Array> {
  const bytes = await readPart(fileOf(organizationId, key, VIDEO_KEY), start, length);
  if (bytes.byteLength !== length) throw new VideoStoreError(409, "Filmfilen i lagringen är kortare än väntat. Ladda upp den igen.");
  return bytes;
}

/** Whether a stored film is there with the size it had. */
export async function storedVideoSize(organizationId: string, key: string): Promise<number | null> {
  const info = await stat(fileOf(organizationId, key, VIDEO_KEY)).catch(() => null);
  return info?.isFile() ? info.size : null;
}

/** A cover picture: JPEG or PNG by its first bytes, at most 2 MB. */
export async function storeThumbnail(organizationId: string, bytes: Uint8Array): Promise<{ key: string; type: string }> {
  if (bytes.byteLength === 0) throw new VideoStoreError(400, "Bilden är tom.");
  if (bytes.byteLength > THUMBNAIL_MAX_BYTES) throw new VideoStoreError(413, "Omslagsbilden får vara högst 2 MB.");
  const type = imageKindOf(bytes);
  if (!type) throw new VideoStoreError(400, "Omslagsbilden ska vara en JPEG- eller PNG-bild.");
  const dir = folder(organizationId);
  await mkdir(dir, { recursive: true });
  const key = `${randomUUID()}.${type === "image/png" ? "png" : "jpg"}`;
  await writeFile(path.join(dir, key), bytes, { mode: 0o640, flag: "wx" });
  return { key, type };
}

export async function readThumbnail(organizationId: string, key: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  try {
    const bytes = new Uint8Array(await readFile(fileOf(organizationId, key, THUMBNAIL_KEY)));
    return { bytes, type: key.endsWith(".png") ? "image/png" : "image/jpeg" };
  } catch { return null; }
}

/** Removes a stored film, a part of one or a cover picture; one that is already gone is fine. */
export async function removeStored(organizationId: string, key: string | null | undefined) {
  if (!key) return;
  const pattern = VIDEO_KEY.test(key) ? VIDEO_KEY : THUMBNAIL_KEY.test(key) ? THUMBNAIL_KEY : UPLOAD_ID.test(key) ? null : undefined;
  if (pattern === undefined) return;
  const file = pattern ? fileOf(organizationId, key, pattern) : path.join(folder(organizationId), `${key}.part`);
  await rm(file, { force: true });
}

/**
 * Removes the company's whole film folder (films, parts and cover pictures) when the company is erased (eraseCompany,
 * granskningen 2026-11-24 G-18). The folder is the company's own, named by its id, so nothing else can be in it.
 */
export async function removeCompanyVideos(organizationId: string) {
  await rm(folder(organizationId), { recursive: true, force: true });
}
