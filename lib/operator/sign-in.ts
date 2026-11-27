import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { DUMMY_PASSWORD_HASH, LOGIN_RATE_LIMITED, verifyPassword } from "@/lib/auth/password";
import { assertMayTry, countIpTry, SIGN_IN_UNAVAILABLE_TEXT } from "@/lib/auth/sign-in-limit";
import { clientIp } from "@/lib/security/client-ip";
import { clearRateLimit, hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-log";
import { normalizeUsername, OPERATOR_LOCK_MINUTES, OPERATOR_PASSWORD_MAX } from "@/lib/operator/rules";
import { settingsByPageKey } from "@/lib/operator/settings-server";

/**
 * Operatörens inloggning med användarnamn och lösenord (2026-10-30). Before a password is looked at: the account's
 * and the IP address's counters (lib/auth/sign-in-limit.ts, refusing while the counter store is down). A wrong password
 * counts; five in a row lock the account for 15 minutes. An unknown name costs the same time (a dummy hash) and gives the
 * same answer, so names cannot be guessed. A blocked account is told only after the right password.
 */
export const WRONG_TEXT = "Fel användarnamn eller lösenord.";
export const LOCKED_TEXT = `För många försök. Försök igen om ${OPERATOR_LOCK_MINUTES} minuter.`;
export const BLOCKED_TEXT = "Kontot är spärrat. Kontakta din administratör.";

const limitError = (error: unknown) => {
  if (error instanceof Error && error.message === LOGIN_RATE_LIMITED) return new ApiError(429, LOCKED_TEXT);
  return new ApiError(503, SIGN_IN_UNAVAILABLE_TEXT);
};

export async function signInWithPassword(input: { pageKey: string; username: string; password: string; headers: Headers }) {
  const settings = await settingsByPageKey(input.pageKey);
  if (!settings) throw new ApiError(404, "Sidan finns inte. Fråga din administratör efter rätt adress.");
  const organizationId = settings.organizationId;
  const name = normalizeUsername(input.username);
  const subject = `${organizationId}:${name.ok ? name.key : input.username.trim().toLowerCase().slice(0, 100)}`;
  try {
    await assertMayTry(RATE_RULES.operatorAccount, subject);
    await countIpTry(RATE_RULES.operatorIp, clientIp(input.headers));
  } catch (error) {
    throw limitError(error);
  }
  const account = name.ok ? await prisma.operatorAccount.findUnique({
    where: { organizationId_usernameKey: { organizationId, usernameKey: name.key } },
    select: { id: true, kind: true, passwordHash: true, active: true },
  }) : null;
  const passwordOk = await verifyPassword(input.password.slice(0, OPERATOR_PASSWORD_MAX), account?.kind === "password" && account.passwordHash ? account.passwordHash : DUMMY_PASSWORD_HASH);
  if (!account || account.kind !== "password" || !passwordOk) {
    const hit = await hitRateLimit(RATE_RULES.operatorAccount, subject);
    const locked = !hit.allowed || hit.count >= RATE_RULES.operatorAccount.limit;
    await recordSecurityEvent({ type: locked ? "operator_locked" : "operator_login_failed", organizationId, actorId: account ? `operator:${account.id}` : null, platform: false, detail: "Lösenord", headers: input.headers });
    if (hit.unavailable) throw new ApiError(503, SIGN_IN_UNAVAILABLE_TEXT);
    throw new ApiError(locked ? 429 : 401, locked ? LOCKED_TEXT : WRONG_TEXT);
  }
  if (!account.active) throw new ApiError(403, BLOCKED_TEXT);
  await clearRateLimit(RATE_RULES.operatorAccount, subject).catch(() => undefined);
  await recordSecurityEvent({ type: "operator_login_ok", organizationId, actorId: `operator:${account.id}`, platform: false, detail: "Lösenord", headers: input.headers });
  return { accountId: account.id, organizationId, pageKey: settings.pageKey };
}
