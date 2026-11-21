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
 * A film comes in pieces of 8 MB (as the landing page's films, ee/landing/films.ts): the first piece starts an upload, each
 * following piece must start where the stored part ends, and when the last piece is in the file is checked by its first bytes
 * (MP4, MOV or WebM) before it gets its name. A part never finished is removed after a day.
 */
const ORG = /^[A-Za-z0-9_-]{8,40}$/;
const UPLOAD_ID = /^[a-f0-9-]{36}$/;
export const VIDEO_KEY = /^[a-f0-9-]{36}\.(mp4|mov|webm)$/;
export const THUMBNAIL_KEY = /^[a-f0-9-]{36}\.(jpg|png)$/;
const STALE_PART_MS = 24 * 60 * 60 * 1000;

export class VideoStoreError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
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

export async function storeVideoChunk(organizationId: string, { upload, offset, total, bytes, maxBytes }: VideoChunk): Promise<VideoChunkResult> {
  if (!Number.isInteger(total) || total <= 0) throw new VideoStoreError(400, "Filen är tom.");
  if (total > maxBytes) throw new VideoStoreError(413, `Filmen är större än ${Math.round(maxBytes / 1024 / 1024)} MB, som är taket i den här installationen.`);
  if (!Number.isInteger(offset) || offset < 0 || bytes.byteLength === 0 || bytes.byteLength > VIDEO_CHUNK_BYTES || offset + bytes.byteLength > total)
    throw new VideoStoreError(400, "Uppladdningen gick inte ihop. Försök igen.");
  const dir = folder(organizationId);
  await mkdir(dir, { recursive: true });
  let id = upload;
  if (offset === 0) {
    if (upload) throw new VideoStoreError(400, "Uppladdningen gick inte ihop. Försök igen.");
    // The first bytes say at once whether it is a film, so a wrong file stops before gigabytes are sent.
    if (!videoKindOf(bytes.subarray(0, 64))) throw new VideoStoreError(400, "Filen är ingen film i formatet MP4, MOV eller WebM.");
    await removeStaleParts(dir);
    id = randomUUID();
  } else if (!UPLOAD_ID.test(upload)) throw new VideoStoreError(400, "Uppladdningen gick inte ihop. Försök igen.");
  const part = path.join(dir, `${id}.part`);
  if (offset > 0) {
    const info = await stat(part).catch(() => null);
    if (!info || info.size !== offset) throw new VideoStoreError(409, "Uppladdningen avbröts. Börja om.");
  }
  const handle = await open(part, offset === 0 ? "wx" : "a", 0o640);
  try { await handle.write(bytes); } finally { await handle.close(); }
  const received = offset + bytes.byteLength;
  if (received < total) return { done: false, upload: id, received };
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
