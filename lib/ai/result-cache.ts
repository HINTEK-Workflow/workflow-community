import { createHash } from "node:crypto";

/**
 * Answers the AI model has already written from exactly the same material (plan 2026-10-01, fas 0): "Skriv med AI"
 * clicked again on an unchanged protocol gets the same text back without a new call and without credits. Kept in the
 * server's memory only, per company, for a day; nothing is shared between companies and nothing is written to disk.
 */
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
type Entry = { at: number; answer: string; model: string };
const entries = new Map<string, Entry>();

/** The key: the company, the agent, the model and the material, hashed – the material itself is not kept as a key. */
export function resultCacheKey(input: { organizationId: string; agentId: string; model: string; material: string }) {
  return createHash("sha256").update([input.organizationId, input.agentId, input.model, input.material.replace(/\s+/g, " ").trim()].join("\u0000")).digest("hex");
}

export function readCachedResult(key: string, now = Date.now()): Entry | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (now - entry.at >= TTL_MS) { entries.delete(key); return null; }
  return entry;
}

export function storeCachedResult(key: string, answer: string, model: string, now = Date.now()) {
  // The oldest go first when the cache is full (a Map keeps insertion order).
  entries.delete(key);
  while (entries.size >= MAX_ENTRIES) { const oldest = entries.keys().next().value; if (oldest === undefined) break; entries.delete(oldest); }
  entries.set(key, { at: now, answer, model });
}

/** For tests. */
export function clearResultCache() { entries.clear(); }
