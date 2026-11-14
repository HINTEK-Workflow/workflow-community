import { LOGIN_RATE_LIMITED, LOGIN_UNAVAILABLE } from "@/lib/auth/password";
import { ApiError } from "@/lib/kfid/errors";
import { UNKNOWN_CLIENT_IP } from "@/lib/security/client-ip";
import { hitRateLimit, type RateRule, rateLimitState } from "@/lib/security/rate-limit";

/**
 * Inloggningsspärren (security review 2026-10-04, fail closed 2026-10-11): the checks every way of signing in makes
 * before a password, a code or a passkey is looked at. Over the limit gives LOGIN_RATE_LIMITED; a counter that cannot
 * be read or written gives LOGIN_UNAVAILABLE ("Försök igen om en stund") – never a try without the shared count.
 */

/** The calm words for a counter that cannot be reached (the sign-in form and the API answers say the same). */
export const SIGN_IN_UNAVAILABLE_TEXT = "Det gick inte att kontrollera inloggningen just nu. Försök igen om en stund.";
export const SIGN_IN_LIMITED_TEXT = "För många försök. Vänta en kvart och försök igen.";

/** Throws the sign-in's refusal while the subject (an address or a person) may not try, without counting. */
export async function assertMayTry(rule: RateRule, subject: string) {
  const state = await rateLimitState(rule, subject);
  if (state === "unavailable") throw new Error(LOGIN_UNAVAILABLE);
  if (state === "limited") throw new Error(LOGIN_RATE_LIMITED);
}

/** Counts one try for the IP address (skipped when the proxy did not tell it) and throws the refusal past the limit. */
export async function countIpTry(rule: RateRule, ip: string) {
  if (ip === UNKNOWN_CLIENT_IP) return;
  const hit = await hitRateLimit(rule, ip);
  if (hit.unavailable) throw new Error(LOGIN_UNAVAILABLE);
  if (!hit.allowed) throw new Error(LOGIN_RATE_LIMITED);
}

/**
 * The same check for a signed-in person's fresh confirmation (current password, passkey or code in the API): 429 past
 * the limit, 503 while the counter cannot be reached, with the texts above.
 */
export async function assertMayTryApi(rule: RateRule, subject: string, limitedText = SIGN_IN_LIMITED_TEXT) {
  const state = await rateLimitState(rule, subject);
  if (state === "unavailable") throw new ApiError(503, SIGN_IN_UNAVAILABLE_TEXT);
  if (state === "limited") throw new ApiError(429, limitedText);
}
