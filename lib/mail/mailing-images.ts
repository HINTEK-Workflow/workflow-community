import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Bilder i utskick (2026-10-03): images for newsletters live in their own folder and are served publicly from
 * the installation itself, because mail programs fetch them without signing in. Only this folder is public – never the
 * companies' attachments – and only images that were checked by their first bytes.
 */
const root = () => path.resolve(env.STORAGE_ROOT, "mailing-images");
const KEY = /^[a-f0-9-]{36}\.(png|jpg|gif|webp)$/;
export const MAILING_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const MAILING_IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** The kind of image from its first bytes, never from the name or the browser's claim. */
export function imageKind(bytes: Uint8Array): keyof typeof MAILING_IMAGE_TYPES | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "png";
  if (starts(0xff, 0xd8, 0xff)) return "jpg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  return null;
}

export async function storeMailingImage(bytes: Uint8Array) {
  const kind = imageKind(bytes);
  if (!kind) throw new Error("Filen är ingen PNG-, JPG-, GIF- eller WebP-bild.");
  if (bytes.byteLength > MAILING_IMAGE_MAX_BYTES) throw new Error("Bilden är större än 2 MB.");
  await mkdir(root(), { recursive: true });
  const key = `${randomUUID()}.${kind}`;
  await writeFile(path.join(root(), key), bytes, { mode: 0o644 });
  return key;
}

export async function readMailingImage(key: string) {
  if (!KEY.test(key)) return null;
  try { return { bytes: await readFile(path.join(root(), key)), type: MAILING_IMAGE_TYPES[key.split(".").pop()!] }; } catch { return null; }
}
