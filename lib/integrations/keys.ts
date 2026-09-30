import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

// Central key administration (Daniel 2026-09-29). Pure helpers without Prisma or HTTP, shared by the key API and a future
// API/MCP server: the token format of the keys Workflow issues, their hash, the encryption of external keys and the rules.

import { type IssuedKind, KEY_SCOPES } from "./key-catalog";
export * from "./key-catalog";

const TOKEN_PREFIX: Record<IssuedKind, string> = { API: "hwf_api", MCP: "hwf_mcp" };

/** A new issued key: the token shown once, the hash stored, and a short hint that identifies it in lists. */
export function newIssuedToken(kind: IssuedKind, id: string) {
  const secret = randomBytes(32).toString("base64url");
  const token = `${TOKEN_PREFIX[kind]}_${id}_${secret}`;
  return { token, secretHash: hashSecret(secret), displayHint: `${TOKEN_PREFIX[kind]}_${id.slice(-6)}…${secret.slice(-4)}` };
}

export function hashSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function parseIssuedToken(token: string): { kind: IssuedKind; id: string; secret: string } | null {
  const match = /^hwf_(api|mcp)_([a-z0-9]{20,40})_([A-Za-z0-9_-]{40,60})$/.exec(token.trim());
  if (!match) return null;
  return { kind: match[1] === "api" ? "API" : "MCP", id: match[2], secret: match[3] };
}

/** Constant-time comparison of a presented secret with the stored hash. */
export function secretMatches(secret: string, storedHash: string) {
  const presented = Buffer.from(hashSecret(secret), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}

export type StoredIssuedKey = {
  kind: "API" | "MCP" | "EXTERNAL"; secretHash: string | null; revokedAt: Date | null; expiresAt: Date | null; scopes: string[];
};
/** Why a presented token is refused, or null when it may be used (the creator's rights are checked separately). */
export function issuedKeyProblem(parsed: ReturnType<typeof parseIssuedToken>, stored: StoredIssuedKey | null, now = new Date(), scope?: string) {
  if (!parsed || !stored || stored.kind !== parsed.kind || !stored.secretHash || !secretMatches(parsed.secret, stored.secretHash)) return "invalid";
  if (stored.revokedAt) return "revoked";
  if (stored.expiresAt && stored.expiresAt <= now) return "expired";
  if (scope && !stored.scopes.includes(scope)) return "scope";
  return null;
}

// ---- External keys: AES-256-GCM with a key derived from the server secret ----

/**
 * The encryption key: INTEGRATION_KEYS_SECRET when set, otherwise derived from AUTH_SECRET with its own label. Changing
 * the secret makes stored external keys unreadable (they are then entered again); issued keys are unaffected.
 */
function encryptionKey(secret: string) {
  if (!secret || secret.length < 16) throw new Error("Serverns hemlighet för nycklar saknas.");
  return Buffer.from(hkdfSync("sha256", secret, "hintek-workflow", "integration-keys-v1", 32));
}

export function encryptExternalKey(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptExternalKey(stored: string, secret: string) {
  const [version, iv, tag, body] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Nyckeln har ett okänt format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** The only part of an external key ever shown again. */
export function externalHint(value: string) {
  const trimmed = value.trim();
  return trimmed.length <= 8 ? "••••" : `••••${trimmed.slice(-4)}`;
}

export function validScopes(kind: IssuedKind, scopes: string[]) {
  const allowed = new Set<string>(KEY_SCOPES[kind].map((item) => item.key));
  const unique = [...new Set(scopes)];
  return unique.length > 0 && unique.every((scope) => allowed.has(scope)) ? unique : null;
}
