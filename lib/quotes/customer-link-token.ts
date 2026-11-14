import { createHash, randomBytes } from "node:crypto";
import { isQuoteLinkToken, quoteContentFingerprint, type QuoteContent } from "./customer-link";

/**
 * Offert per e-post, steg E: the link token and the hashes (server only). The token is 32 random bytes (base64url, 43
 * characters) and exists only in the e-mail; the database keeps its sha256. The content hash is the sha256 of the
 * quote's customer-facing fingerprint (lib/quotes/customer-link.ts).
 */
export const QUOTE_LINK_TOKEN_BYTES = 32;

export function createQuoteLinkToken(): string {
  return randomBytes(QUOTE_LINK_TOKEN_BYTES).toString("base64url");
}

/** sha256 (hex) of a token; null for anything that is not a token, so it is never looked up. */
export function hashQuoteLinkToken(token: unknown): string | null {
  return isQuoteLinkToken(token) ? createHash("sha256").update(token, "utf8").digest("hex") : null;
}

export function quoteContentHash(quote: QuoteContent): string {
  return createHash("sha256").update(quoteContentFingerprint(quote), "utf8").digest("hex");
}
