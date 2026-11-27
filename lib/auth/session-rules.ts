/**
 * Aktiva inloggningar och färsk inloggning (2026-10-10), the rules without a database, so they can be tested alone.
 *
 * Sessions stay JWTs (NextAuth); each sign-in also gets a UserSession row whose id travels in the token as `sid`. The
 * jwt callback, which already reads the person on every session check, refuses a token whose row is revoked, gone or
 * unused for longer than a session lives. A token without `sid` (signed in before 2026-10-10, or a loopback QA token)
 * is ended by User.sessionsRevokedAt ("Logga ut överallt") and by a password change, as before.
 */
export const REAUTH_WINDOW_SECONDS = 10 * 60;
/**
 * Maskinlarm (2026-10-24, "Ja, bekräfta innan ändring"): a format profile or a rule that can make work orders is
 * changed only after a sign-in or a confirmation within the last 15 minutes.
 */
export const MACHINE_CONFIRM_WINDOW_SECONDS = 15 * 60;
/** lastSeenAt is written at most this often per session, so a busy page does not write on every request. */
export const SESSION_TOUCH_SECONDS = 5 * 60;

type SessionRow = { userId: string; revokedAt: Date | null; lastSeenAt: Date } | null | undefined;

/** Whether a session row no longer lets the token in. */
export function sessionRowEnded(row: SessionRow, userId: string, maxAgeSeconds: number, now = Date.now()) {
  if (!row || row.userId !== userId || row.revokedAt) return true;
  return row.lastSeenAt.getTime() + maxAgeSeconds * 1000 < now;
}

export const sessionNeedsTouch = (lastSeenAt: Date, now = Date.now()) => now - lastSeenAt.getTime() >= SESSION_TOUCH_SECONDS * 1000;

/**
 * Längsta inloggning (säkerhetsgranskningen 2026-11-24, G-21): however often it is used, a sign-in ends this long after it
 * was made (authAt, seconds); a superadmin's sooner. A token without authAt is ended by the other rules.
 */
export const SESSION_ABSOLUTE_SECONDS = 7 * 24 * 3600;
export const SUPERADMIN_SESSION_ABSOLUTE_SECONDS = 12 * 3600;
export function sessionTooOld(authAt: number | undefined, role: string | undefined, now = Date.now()) {
  if (!authAt) return false;
  const limit = role === "SUPERADMIN" ? SUPERADMIN_SESSION_ABSOLUTE_SECONDS : SESSION_ABSOLUTE_SECONDS;
  return now - authAt * 1000 > limit * 1000;
}

/** A token signed in (authAt, seconds) before a password change or "Logga ut överallt" has ended. */
export function tokenRevoked(authAt: number | undefined, ...cutoffs: (Date | null | undefined)[]) {
  if (!authAt) return false;
  return cutoffs.some((cutoff) => Boolean(cutoff && authAt < Math.floor(cutoff.getTime() / 1000)));
}

/** Färsk inloggning: signed in, or confirmed with password or code, within the last ten minutes (or the window given). */
export function freshlyAuthenticated(authAt: number | undefined, reauthAt: Date | null | undefined, now = Date.now(), windowSeconds = REAUTH_WINDOW_SECONDS) {
  const limit = now - windowSeconds * 1000;
  return Boolean((authAt && authAt * 1000 >= limit) || (reauthAt && reauthAt.getTime() >= limit));
}

/** How the person signed in, in words (client-safe). */
export const SIGN_IN_METHOD_LABELS: Record<string, string> = {
  password: "Lösenord",
  "password+totp": "Lösenord och kod",
  "password+backup": "Lösenord och reservkod",
  google: "Google",
  "google+totp": "Google och kod",
  "google+backup": "Google och reservkod",
  "microsoft+totp": "Microsoft och kod",
  "microsoft+backup": "Microsoft och reservkod",
  // Microsofts tvåsteg räknades som andra steg (2026-11-27): Microsoft intygade flerfaktor i ID-token.
  "microsoft+mfa": "Microsoft med Microsofts tvåsteg",
  passkey: "Passkey",
  microsoft: "Microsoft",
  // The loopback QA entrance (app/api/qa/session), never on a public server.
  qa: "Testinloggning",
};

/**
 * Sign-ins that meet a two-step requirement by themselves: a passkey (the device plus its fingerprint, face or PIN –
 * Workflow requires that user verification). Google and Microsoft counted too until the security review 2026-11-24 (G-09):
 * two-step verification now applies however the person signs in, so with TOTP on a Google or Microsoft sign-in asks for the
 * code as well, and a company or superadmin requirement is met only by TOTP or a passkey.
 * Since the decision of 2026-11-27 also "microsoft+mfa": a Microsoft sign-in whose verified ID token says Microsoft's own
 * multi-factor was done (amr holds "mfa") while the product owner's switch is on (lib/auth/microsoft.ts). A plain
 * "microsoft" (no such word from Microsoft) still is not.
 */
const STRONG_SIGN_IN_METHODS = new Set(["passkey", "microsoft+mfa"]);
export const strongSignInMethod = (method: string | undefined) => Boolean(method && STRONG_SIGN_IN_METHODS.has(method));

/** The message a work API gives while a required two-step verification is not set up; the workspace shows the setup. */
export const TWO_FACTOR_SETUP_REQUIRED = "Tvåstegsverifiering krävs. Slå på den under Mina inställningar → Säkerhet innan du fortsätter.";
