import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// OAuth 2.1 for the MCP server (2026-10-02). Pure rules without Prisma or HTTP: scopes, PKCE, redirect
// addresses and the token format, so they can be tested on their own.

export const OAUTH_SCOPES = ["mcp:read", "mcp:write", "mcp:delete"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];
export const SCOPE_LABEL: Record<OAuthScope, string> = { "mcp:read": "Söka och läsa", "mcp:write": "Skapa och ändra", "mcp:delete": "Ta bort och arkivera (går att återställa)" };

export const CODE_TTL_MS = 5 * 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;

/** The scopes asked for: known ones only; reading is always part of a connection. Nothing asked for means read and write. */
export function requestedScopes(scope: string | null | undefined): OAuthScope[] {
  const asked = (scope ?? "").split(/\s+/).filter(Boolean);
  const known = OAUTH_SCOPES.filter((item) => asked.includes(item));
  const chosen = asked.length ? known : (["mcp:read", "mcp:write"] as OAuthScope[]);
  return chosen.includes("mcp:read") ? chosen : ["mcp:read", ...chosen];
}

/** What the person approved, limited to what the app asked for (reading always included). */
export function approvedScopes(approved: string[], asked: OAuthScope[]): OAuthScope[] {
  const chosen = asked.filter((item) => approved.includes(item));
  return chosen.includes("mcp:read") ? chosen : ["mcp:read", ...chosen];
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:"]);

/** A redirect address an app may register: https, http only on this computer, or an app's own scheme (cursor://…). */
export function validRedirectUri(value: string) {
  if (value.length > 500) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return Boolean(url.hostname);
  if (url.protocol === "http:") return LOOPBACK.has(url.hostname);
  return !FORBIDDEN_SCHEMES.has(url.protocol) && /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

/** The registered address the request names: exact, except that a loopback address may use any port (RFC 8252). */
export function redirectMatches(registered: string[], requested: string) {
  if (registered.includes(requested)) return true;
  let asked: URL;
  try { asked = new URL(requested); } catch { return false; }
  if (asked.protocol !== "http:" || !LOOPBACK.has(asked.hostname)) return false;
  return registered.some((item) => {
    try {
      const url = new URL(item);
      return url.protocol === "http:" && url.hostname === asked.hostname && url.pathname === asked.pathname && url.search === asked.search;
    } catch { return false; }
  });
}

/** PKCE (S256 only): the verifier the app shows now must hash to the challenge it sent at the start. */
export function pkceMatches(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier, "ascii").digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export const validChallenge = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);

export const hashToken = (secret: string) => createHash("sha256").update(secret, "utf8").digest("hex");
export function sameHash(secret: string, storedHash: string) {
  const presented = Buffer.from(hashToken(secret), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}
export const newSecret = () => randomBytes(32).toString("base64url");

const PREFIX = { ACCESS: "hwf_oat", REFRESH: "hwf_ort" } as const;
export type TokenKind = keyof typeof PREFIX;
export const formatToken = (kind: TokenKind, id: string, secret: string) => `${PREFIX[kind]}_${id}_${secret}`;
export function parseToken(token: string): { kind: TokenKind; id: string; secret: string } | null {
  const match = /^hwf_(oat|ort)_([a-z0-9]{20,40})_([A-Za-z0-9_-]{40,60})$/.exec(token.trim());
  return match ? { kind: match[1] === "oat" ? "ACCESS" : "REFRESH", id: match[2], secret: match[3] } : null;
}
export const isOAuthAccessToken = (token: string) => token.startsWith(`${PREFIX.ACCESS}_`);
