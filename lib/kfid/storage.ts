import path from "node:path";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
const root = path.resolve(env.STORAGE_ROOT, "kfid");
export function filePath(key: string) {
  if (!/^[a-zA-Z0-9-]+\.[a-z0-9]+$/.test(key))
    throw new Error("Invalid storage key");
  return path.join(root, key);
}
export async function store(buffer: Uint8Array, extension: string) {
  await mkdir(root, { recursive: true });
  const key = `${randomUUID()}.${extension}`;
  await writeFile(filePath(key), buffer, { mode: 0o600 });
  return key;
}
export async function read(key: string) {
  return readFile(filePath(key));
}
export async function remove(key: string) {
  await unlink(filePath(key)).catch(() => {});
}
