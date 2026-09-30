import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { env } from "@/lib/env";

export type StoredFile = {
  absolutePath: string;
  relativePath: string;
  filename: string;
  mimeType: string;
  size: number;
};

const attachmentRoot = path.resolve(env.STORAGE_ROOT, "attachments");

export async function ensureStorageDirectories() {
  await mkdir(attachmentRoot, { recursive: true });
}

export function resolveStoragePath(relativePath: string) {
  return path.resolve(env.STORAGE_ROOT, relativePath);
}

export async function saveAttachment(input: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}) {
  await ensureStorageDirectories();

  const extension = path.extname(input.originalName) || "";
  const filename = `${randomUUID()}${extension.toLowerCase()}`;
  const relativePath = path.join("attachments", filename);
  const absolutePath = resolveStoragePath(relativePath);

  await writeFile(absolutePath, input.buffer);

  return {
    absolutePath,
    relativePath,
    filename,
    mimeType: input.mimeType,
    size: input.buffer.byteLength,
  } satisfies StoredFile;
}

export async function readStoredFile(relativePath: string) {
  return readFile(resolveStoragePath(relativePath));
}
