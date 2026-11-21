import { createHmac, hkdfSync, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * A shared link's session and code (Tavlor etapp 2, 2026-11-18; plan 6.4). Pure crypto with the secrets passed in, so it is tested
 * without a server (tests/boards-screens.test.ts). The session cookie is `<link id>.<expires ms>.<mac>`, the mac over the id, the time
 * and the link's current secret hash, so a renewed link ends every old session; the code is stored as a salted scrypt hash.
 */
const cookieKey = (secret: string) => Buffer.from(hkdfSync("sha256", secret, "hintek-workflow", "board-link-session-v1", 32));
const mac = (secret: string, body: string) => createHmac("sha256", cookieKey(secret)).update(body).digest("base64url");

export function signLinkSession(secret: string, accessId: string, tokenHash: string, expiresAt: number) {
  const body = `${accessId}.${expiresAt}`;
  return `${body}.${mac(secret, `${body}.${tokenHash}`)}`;
}

/** The session's link and end, and a check of its mac against the link's current secret hash with any of the ring's secrets. */
export function readLinkSession(value: string | undefined, secrets: readonly string[], now = Date.now()): { accessId: string; expiresAt: number; macOf: (tokenHash: string) => boolean } | null {
  const parts = (value ?? "").split(".");
  if (parts.length !== 3 || !parts[0] || parts[0].length > 60) return null;
  const [accessId, expires, given] = parts;
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  const macOf = (tokenHash: string) => secrets.some((secret) => {
    const expected = Buffer.from(mac(secret, `${accessId}.${expires}.${tokenHash}`));
    const got = Buffer.from(given);
    return expected.length === got.length && timingSafeEqual(expected, got);
  });
  return { accessId, expiresAt, macOf };
}

export function hashLinkCode(code: string, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(code, salt, 32).toString("hex")}`;
}
export function linkCodeMatches(code: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const given = scryptSync(code, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return expected.length === given.length && timingSafeEqual(given, expected);
}
