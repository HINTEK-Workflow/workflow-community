import { prisma } from "@/lib/db";

/**
 * Systemloggar som rensar sig själva (2026-10-03: "inga onödigt långa logglistor, de måste kunna raderas eller
 * raderas själv efter ett tag"). Whatever the companies choose under Historik och lagring, these technical records
 * have no use after a while and are removed every night by the history:retention job:
 *  - used or expired sign-in, verification, password reset and OAuth codes, a week after they ended;
 *  - OAuth access tokens a month after they expired or were revoked;
 *  - the superadmin's checks of the server's keys after 90 days (only the latest per key is shown);
 *  - the key alarms' "already sent" marks after 400 days;
 *  - mailings with their recipient lists after 12 months.
 */
export const SYSTEM_RETENTION = { codesDays: 7, tokensDays: 30, keyChecksDays: 90, keyAlertsDays: 400, mailingsMonths: 12 } as const;

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

export async function pruneSystemLogs(now = new Date()) {
  const codes = daysAgo(now, SYSTEM_RETENTION.codesDays);
  const mailingsBefore = new Date(now);
  mailingsBefore.setMonth(mailingsBefore.getMonth() - SYSTEM_RETENTION.mailingsMonths);
  const ended = (field: "expiresAt") => ({ OR: [{ [field]: { lt: codes } }, { usedAt: { lt: codes } }] });
  const [verification, passwordReset, oauthCodes, oauthTokens, keyChecks, keyAlerts, mailings] = await Promise.all([
    prisma.verificationToken.deleteMany({ where: ended("expiresAt") }),
    prisma.passwordResetToken.deleteMany({ where: ended("expiresAt") }),
    prisma.oAuthAuthorizationCode.deleteMany({ where: ended("expiresAt") }),
    prisma.oAuthToken.deleteMany({ where: { OR: [{ expiresAt: { lt: daysAgo(now, SYSTEM_RETENTION.tokensDays) } }, { revokedAt: { lt: daysAgo(now, SYSTEM_RETENTION.tokensDays) } }] } }),
    prisma.administrationEvent.deleteMany({ where: { action: { startsWith: "server_key_check:" }, createdAt: { lt: daysAgo(now, SYSTEM_RETENTION.keyChecksDays) } } }),
    prisma.administrationEvent.deleteMany({ where: { action: { startsWith: "key_expiry_alert:" }, createdAt: { lt: daysAgo(now, SYSTEM_RETENTION.keyAlertsDays) } } }),
    prisma.mailing.deleteMany({ where: { createdAt: { lt: mailingsBefore } } }),
  ]);
  return {
    verification: verification.count, passwordReset: passwordReset.count, oauthCodes: oauthCodes.count, oauthTokens: oauthTokens.count,
    keyChecks: keyChecks.count, keyAlerts: keyAlerts.count, mailings: mailings.count,
  };
}
