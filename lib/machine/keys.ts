import { randomBytes } from "node:crypto";
import { hashSecret, secretMatches } from "@/lib/integrations/keys";

// Maskinintag (S2): the key of ONE source. It is not a member's key and not an IntegrationKey: it can send events for its
// own source and nothing else, never read and never act as a person. Shown once, stored as a SHA-256 hash only.

const PREFIX = "hwf_mch";
export const SOURCE_KEY_EXPIRY_DAYS = [90, 365, 730] as const;

/** A new key for a source: the token shown once, the hash stored, and a short hint that identifies it in lists. */
export function newSourceToken(sourceId: string) {
  const secret = randomBytes(32).toString("base64url");
  return { token: `${PREFIX}_${sourceId}_${secret}`, secretHash: hashSecret(secret), displayHint: `${PREFIX}_${sourceId.slice(-6)}…${secret.slice(-4)}` };
}

export function parseSourceToken(token: string): { id: string; secret: string } | null {
  const match = /^hwf_mch_([a-z0-9]{20,40})_([A-Za-z0-9_-]{40,60})$/.exec(token.trim());
  return match ? { id: match[1], secret: match[2] } : null;
}

export type StoredSourceKey = { secretHash: string | null; keyRevokedAt: Date | null; keyExpiresAt: Date | null; isActive: boolean };

/** Why a presented key is refused, or null when it may send. Wrong secret and unknown source both give "invalid". */
export function sourceKeyProblem(parsed: ReturnType<typeof parseSourceToken>, stored: StoredSourceKey | null, now = new Date()): "invalid" | "revoked" | "expired" | "inactive" | null {
  // Always compare against a hash, also when there is no source, so an unknown id does not answer faster than a wrong secret.
  const reference = stored?.secretHash ?? hashSecret("no-such-source");
  const secretOk = Boolean(parsed) && secretMatches(parsed?.secret ?? "", reference);
  if (!parsed || !stored || !stored.secretHash || !secretOk) return "invalid";
  if (stored.keyRevokedAt) return "revoked";
  if (stored.keyExpiresAt && stored.keyExpiresAt <= now) return "expired";
  if (!stored.isActive) return "inactive";
  return null;
}

/** The 401 text. Only after the secret has matched is "revoked" or "expired" told, so a guess learns nothing. */
export function sourceKeyRefusalText(problem: NonNullable<ReturnType<typeof sourceKeyProblem>>): string {
  switch (problem) {
    case "revoked": return "Nyckeln är återkallad. Skapa en ny för källan.";
    case "expired": return "Nyckeln har gått ut. Skapa en ny för källan.";
    case "inactive": return "Källan är avstängd.";
    default: return "Nyckeln är ogiltig.";
  }
}

/**
 * No key at all (användartest 2026-10-31: the intake said "Nyckeln är ogiltig" also then): said as the API says it. The code
 * stays invalid_key, so a sender that reads the codes is unchanged. The raw intake also takes the key in X-Hintek-Key.
 */
export function sourceKeyMissingText(raw = false): string {
  return raw ? "Nyckel saknas. Skicka källans nyckel som Authorization: Bearer <nyckel> eller i X-Hintek-Key." : "Nyckel saknas. Skicka källans nyckel som Authorization: Bearer <nyckel>.";
}
