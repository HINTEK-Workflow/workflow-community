import { createHash } from "node:crypto";

/**
 * Förhandsbildens cache (2026-11-15, built 2026-11-16): drawing a post's picture takes a second or two, so each drawn JPEG
 * is kept in this process by a hash of everything that makes it – the texts, the template, the logo's choice, the format, the
 * company's colours and logo files and the background's own bytes. The same content is never drawn twice; any change is a new
 * key. Only in memory, a bounded number of pictures and bytes, the oldest used first out; nothing is written anywhere.
 */
export type ImageCache = { get(key: string): Buffer | null; set(key: string, bytes: Buffer): void; clear(): void; readonly size: number };

export function createImageCache(maxEntries = 60, maxBytes = 32 * 1024 * 1024): ImageCache {
  const entries = new Map<string, Buffer>();
  let bytes = 0;
  return {
    get(key) {
      const found = entries.get(key);
      if (!found) return null;
      // Most recently used last.
      entries.delete(key);
      entries.set(key, found);
      return found;
    },
    set(key, value) {
      if (value.byteLength > maxBytes) return;
      const old = entries.get(key);
      if (old) { bytes -= old.byteLength; entries.delete(key); }
      entries.set(key, value);
      bytes += value.byteLength;
      for (const [oldest, buffer] of entries) {
        if (entries.size <= maxEntries && bytes <= maxBytes) break;
        entries.delete(oldest);
        bytes -= buffer.byteLength;
      }
    },
    clear() { entries.clear(); bytes = 0; },
    get size() { return entries.size; },
  };
}

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
/** The key of one picture: its parts in a fixed shape, the background as its own hash. */
export function imageCacheKey(parts: Record<string, unknown>, background: Uint8Array | null): string {
  return sha(JSON.stringify({ ...parts, background: background ? sha(background) : null }));
}
