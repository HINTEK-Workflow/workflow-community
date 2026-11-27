import { createHash } from "node:crypto";

/**
 * Idempotensnyckel (granskningen 2026-11-24, G-22): a client may send `Idempotency-Key: <random id>` with a create request.
 * The same key again within 24 hours, from the same person in the same company, with the same content, gets the first
 * answer and no second record (a double tap, an answer lost on a poor mobile connection, an API client's retry). The same
 * key with other content, or from someone else, is refused with 422. Without the header nothing changes.
 *
 * Pure rules shared by the routes and the unit tests; the database part is lib/security/idempotency-server.ts.
 */
export const IDEMPOTENCY_HEADER = "idempotency-key";
/** Set on an answer that repeats the first one. */
export const IDEMPOTENCY_REPLAYED_HEADER = "Idempotent-Replayed";
/** How long a key is remembered: long enough for any retry, short enough that the table stays small. */
export const IDEMPOTENCY_TTL_HOURS = 24;
const KEY = /^[A-Za-z0-9_-]{8,100}$/;

export const IDEMPOTENCY_TEXT = {
  invalid: "Idempotency-Key ska vara 8–100 tecken: bokstäver a–z, siffror, - och _.",
  reused: "Idempotency-Key har redan använts för en annan begäran. Skapa en ny nyckel för varje ny post.",
  busy: "Samma begäran behandlas redan. Försök igen om en stund.",
} as const;

export type IdempotencyKeyRead = { ok: true; key: string | null } | { ok: false; message: string };

/** The key from the request's header: null without one, a refusal when it is malformed. */
export function readIdempotencyKey(headers: Pick<Headers, "get">): IdempotencyKeyRead {
  const raw = headers.get(IDEMPOTENCY_HEADER);
  if (raw === null) return { ok: true, key: null };
  const key = raw.trim();
  return KEY.test(key) ? { ok: true, key } : { ok: false, message: IDEMPOTENCY_TEXT.invalid };
}

/** sha256 of what was sent (after validation, so the same request always gives the same hash). */
export function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value) ?? "").digest("hex");
}

/** The moment before which a key is forgotten. */
export function idempotencyCutoff(now = new Date()) {
  return new Date(now.getTime() - IDEMPOTENCY_TTL_HOURS * 3_600_000);
}

export type StoredKey = { userId: string; requestHash: string; response: unknown };
export type ReplayDecision = { kind: "none" } | { kind: "replay"; response: Record<string, unknown> } | { kind: "refuse"; message: string } | { kind: "busy" };

/** What to do with a request whose key is already stored (or not). */
export function replayDecision(stored: StoredKey | null, request: { userId: string; requestHash: string }): ReplayDecision {
  if (!stored) return { kind: "none" };
  if (stored.userId !== request.userId || stored.requestHash !== request.requestHash) return { kind: "refuse", message: IDEMPOTENCY_TEXT.reused };
  if (!stored.response || typeof stored.response !== "object") return { kind: "busy" };
  return { kind: "replay", response: stored.response as Record<string, unknown> };
}
