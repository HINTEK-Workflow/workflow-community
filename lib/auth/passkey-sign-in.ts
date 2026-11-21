import { cookies } from "next/headers";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "@/lib/db";
import { mayAuthenticate } from "@/lib/auth/access";
import { PASSKEY_COOKIE, parsePasskeyResponse } from "@/lib/auth/passkey-core";
import { consumeChallenge, verifyPasskeyAssertion } from "@/lib/auth/passkeys";
import { resolveInitialOrganizationId } from "@/lib/auth/service";
import { assertMayTry, countIpTry } from "@/lib/auth/sign-in-limit";
import { clearRateLimit, hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client-ip";
import { recordSecurityEvent } from "@/lib/security/security-log";

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

/** The answers the login form tells apart; everything else is the neutral "did not go through". */
export const PASSKEY_EXPIRED = "PASSKEY_EXPIRED";
export const PASSKEY_UNKNOWN = "PASSKEY_UNKNOWN";

/**
 * Logga in med passkey (2026-10-11), the credentials provider's check. Rate limits as the password path: every try
 * counts per IP address, and a refused signature counts per account; past the limit the account's passkey sign-in is
 * refused like its password. "Vem får logga in" and an inactive account refuse as for any other way in.
 */
export async function authorizePasskey(raw: string | undefined, headers: HeaderSource) {
  const ip = clientIp(headers);
  await countIpTry(RATE_RULES.loginIp, ip);

  const jar = await cookies();
  const challengeId = jar.get(PASSKEY_COOKIE)?.value;
  if (challengeId) jar.delete(PASSKEY_COOKIE);
  const response = parsePasskeyResponse<AuthenticationResponseJSON>(raw);
  if (!response) { await consumeChallenge(challengeId, "login", null); return null; }

  // The owner's address decides the per-account window before any signature work is done.
  const owner = await prisma.userPasskey.findUnique({ where: { credentialId: response.id.slice(0, 1400) }, select: { user: { select: { email: true } } } });
  if (owner) await assertMayTry(RATE_RULES.loginAccount, owner.user.email).catch(async (error) => {
    await consumeChallenge(challengeId, "login", null);
    throw error;
  });

  const result = await verifyPasskeyAssertion(challengeId, "login", response);
  if (!result.ok) {
    if (result.reason === "challenge") throw new Error(PASSKEY_EXPIRED);
    if (result.reason === "unknown") throw new Error(PASSKEY_UNKNOWN);
    if (result.email) await hitRateLimit(RATE_RULES.loginAccount, result.email);
    if (result.userId) await recordSecurityEvent({ type: "login_failed", userId: result.userId, detail: "Passkey", headers });
    return null;
  }

  if (!mayAuthenticate(result.email)) return null;
  const user = await prisma.user.findUnique({
    where: { id: result.userId },
    select: {
      id: true, email: true, name: true, role: true, isActive: true, activeOrganizationId: true,
      organizationMemberships: { where: { isActive: true }, orderBy: [{ organization: { isActive: "desc" } }, { createdAt: "asc" }], select: { organizationId: true }, take: 1 },
    },
  });
  if (!user?.isActive) return null;
  await clearRateLimit(RATE_RULES.loginAccount, user.email);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), activeOrganizationId: resolveInitialOrganizationId(user) } });
  return { id: user.id, email: user.email, name: user.name, role: user.role, signInMethod: "passkey" };
}
