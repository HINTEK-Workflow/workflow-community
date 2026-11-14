import { coarseClient } from "@/lib/security/security-log-core";

/**
 * Passkeys (2026-10-09, built 2026-10-11), the rules without a database or crypto library, so they can be
 * tested alone: the relying party, the challenge's lifetime and single use, the name of a passkey and the rule that a
 * person always keeps one way to sign in.
 */
export type PasskeyPurpose = "login" | "register" | "reauth";
export const PASSKEY_PURPOSES: readonly PasskeyPurpose[] = ["login", "register", "reauth"];

/** The cookie that carries the random id of the started ceremony's challenge (httpOnly, never readable by scripts). */
export const PASSKEY_COOKIE = "wf-passkey";
/** Long enough for the browser's own dialog and for autofill on the login page while the person thinks. */
export const PASSKEY_CHALLENGE_SECONDS = 5 * 60;
/** Each person may keep this many passkeys; more is never needed and keeps the excluded list in options short. */
export const MAX_PASSKEYS_PER_PERSON = 20;
export const PASSKEY_NAME_MAX = 60;
/**
 * The key types offered: EdDSA, ES256 and RS256 (COSE ids), which every passkey provider supports. Named here so the
 * library does not add the experimental post-quantum ML-DSA on runtimes that have it.
 */
export const PASSKEY_ALGORITHMS = [-8, -7, -257];
/** A browser's answer is a few kilobytes; anything far larger is refused before it is parsed further. */
export const PASSKEY_RESPONSE_MAX_BYTES = 32_000;

/**
 * The relying party from the installation's own address: the RP id is the host name (works on localhost for
 * development; a Community installation gets its own), and the origins the browser may report are the app's address
 * and NEXTAUTH_URL when it differs – the same two that checkOrigin accepts.
 */
export function relyingParty(appUrl: string, nextAuthUrl?: string | null) {
  const app = new URL(appUrl);
  const origins = [app.origin];
  if (nextAuthUrl) {
    try { const other = new URL(nextAuthUrl); if (other.hostname === app.hostname && !origins.includes(other.origin)) origins.push(other.origin); } catch { /* not a URL: ignored */ }
  }
  return { rpID: app.hostname, origins };
}

type ChallengeRow = { purpose: string; userId: string | null; expiresAt: Date } | null | undefined;

/** Whether a stored challenge may be used for this ceremony: the same purpose, the same person, not expired. */
export function challengeUsable(row: ChallengeRow, purpose: PasskeyPurpose, userId: string | null, now = Date.now()) {
  if (!row || row.purpose !== purpose) return false;
  if (row.expiresAt.getTime() <= now) return false;
  // A login challenge belongs to nobody yet; register and reauth only to the person who started them.
  return purpose === "login" ? row.userId === null : Boolean(userId && row.userId === userId);
}

/** The person's own label, cleaned: one line, no control characters, at most 60 characters. */
export function cleanPasskeyName(value: string | null | undefined) {
  return (value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, PASSKEY_NAME_MAX).trim();
}

/** The browser's answer, parsed with a ceiling; the library checks every field it uses. */
export function parsePasskeyResponse<T extends { id: string; type: string }>(raw: unknown): T | null {
  if (typeof raw !== "string" || !raw || Buffer.byteLength(raw) > PASSKEY_RESPONSE_MAX_BYTES) return null;
  try {
    const value = JSON.parse(raw) as T;
    return value && typeof value === "object" && typeof value.id === "string" && value.id.length <= 1400 && value.type === "public-key" ? value : null;
  } catch {
    return null;
  }
}

/** A name to start from, from the browser's coarse description: "Passkey – Edge på Windows". */
export function defaultPasskeyName(userAgent: string | null | undefined) {
  const client = coarseClient(userAgent);
  return client && client !== "Annan klient" ? `Passkey – ${client}` : "Passkey";
}

/**
 * Den sista vägen in (2026-10-09): a password, a linked Google or Microsoft account and every passkey each count
 * as one way to sign in. Removing one is allowed only while another remains.
 */
export function signInWaysLeft(account: { hasPassword: boolean; linkedAccounts: number; passkeys: number }) {
  return (account.hasPassword ? 1 : 0) + account.linkedAccounts + account.passkeys;
}
export const mayRemoveSignInWay = (account: { hasPassword: boolean; linkedAccounts: number; passkeys: number }) => signInWaysLeft(account) > 1;

export const LAST_SIGN_IN_WAY = "Det här är ditt enda sätt att logga in och kan inte tas bort. Lägg till ett lösenord, en passkey eller ett kopplat konto först.";
