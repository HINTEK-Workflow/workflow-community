import { prisma } from "@/lib/db";
import { cleanRateLimits } from "@/lib/security/rate-limit";
import { getAnalyticsSettings } from "@/lib/analytics/settings";
import { pruneCounters } from "@/lib/analytics/store";
import { pruneSecurityLog } from "@/lib/security/security-log";
import { RAW_DEDUPE_MS, RAW_ID_DEDUPE_DAYS, RAW_ID_HASH_PREFIX, RAW_SAMPLE_HOURS } from "@/lib/machine/raw-profile";
import { DAY_SUMMARY_MONTHS } from "@/lib/machine/key-figures";
import { swedishDayKey } from "@/lib/swedish-time";

/**
 * Systemloggar som rensar sig själva (2026-10-03: "inga onödigt långa logglistor, de måste kunna raderas eller
 * raderas själv efter ett tag"). Whatever the companies choose under Historik och lagring, these technical records
 * have no use after a while and are removed every night by the history:retention job:
 *  - used or expired sign-in, verification, password reset and OAuth codes, a week after they ended;
 *  - OAuth access tokens a month after they expired or were revoked;
 *  - the superadmin's checks of the server's keys after 90 days (only the latest per key is shown);
 *  - the key alarms' "already sent" marks after 400 days;
 *  - mailings with their recipient lists after 12 months;
 *  - the anonymous usage counters of Beteendeanalys after the retention time chosen there (14 months unless changed);
 *  - the security log after 12 months, and ended sessions a month after they ended (2026-10-10);
 *  - machine events (Maskinintag) after 90 days (2026-10-19); the objects' daily summaries (integrationsmotorn E6,
 *    counted from the events the same night before they go) after 24 months (decision 2026-10-18 point 6);
 *  - the machines' caught raw samples after 24 hours and the raw intake's body hashes after 10 minutes (integrationsmotorn E4);
 *    a record's own id after 7 days (a format profile with an id, 2026-11-02);
 *  - the screens' pairing requests (Tavlor etapp 2, 2026-11-18) a day after they ended.
 */
export const SYSTEM_RETENTION = { codesDays: 7, tokensDays: 30, keyChecksDays: 90, keyAlertsDays: 400, mailingsMonths: 12, machineEventsDays: 90, machineDaySummaryMonths: DAY_SUMMARY_MONTHS } as const;

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

/** `dryRun` (T5, 2026-10-24: `npm run history:retention -- --dry-run`): the same rows are counted and nothing is deleted. */
export async function pruneSystemLogs(now = new Date(), options: { dryRun?: boolean } = {}) {
  const dryRun = Boolean(options.dryRun);
  const codes = daysAgo(now, SYSTEM_RETENTION.codesDays);
  const mailingsBefore = new Date(now);
  mailingsBefore.setMonth(mailingsBefore.getMonth() - SYSTEM_RETENTION.mailingsMonths);
  const summariesBefore = new Date(now);
  summariesBefore.setMonth(summariesBefore.getMonth() - SYSTEM_RETENTION.machineDaySummaryMonths);
  const ended = (field: "expiresAt") => ({ OR: [{ [field]: { lt: codes } }, { usedAt: { lt: codes } }] });
  // Each table: counted in a dry run, deleted otherwise; both give the number of rows.
  const rows = (count: () => Promise<number>, remove: () => Promise<{ count: number }>) => dryRun ? count() : remove().then((result) => result.count);
  const tokens = { OR: [{ expiresAt: { lt: daysAgo(now, SYSTEM_RETENTION.tokensDays) } }, { revokedAt: { lt: daysAgo(now, SYSTEM_RETENTION.tokensDays) } }] };
  const keyChecksWhere = { action: { startsWith: "server_key_check:" }, createdAt: { lt: daysAgo(now, SYSTEM_RETENTION.keyChecksDays) } };
  const keyAlertsWhere = { action: { startsWith: "key_expiry_alert:" }, createdAt: { lt: daysAgo(now, SYSTEM_RETENTION.keyAlertsDays) } };
  const mailingsWhere = { createdAt: { lt: mailingsBefore } };
  const machineEventsWhere = { receivedAt: { lt: daysAgo(now, SYSTEM_RETENTION.machineEventsDays) } };
  const rawSamplesWhere = { receivedAt: { lt: new Date(now.getTime() - RAW_SAMPLE_HOURS * 3_600_000) } };
  // A record's own id (a profile with an id) is remembered for a week; a body's hash for ten minutes.
  const rawDedupesWhere = { OR: [{ createdAt: { lt: new Date(now.getTime() - RAW_DEDUPE_MS) }, NOT: { hash: { startsWith: RAW_ID_HASH_PREFIX } } }, { createdAt: { lt: daysAgo(now, RAW_ID_DEDUPE_DAYS) } }] };
  const daySummariesWhere = { day: { lt: swedishDayKey(summariesBefore) } };
  const pairingsWhere = { expiresAt: { lt: daysAgo(now, 1) } };
  const [verification, passwordReset, oauthCodes, oauthTokens, keyChecks, keyAlerts, mailings, rateLimits, analytics, security, machineEvents, machineRawSamples, machineRawDedupes, machineDaySummaries, screenPairings] = await Promise.all([
    rows(() => prisma.verificationToken.count({ where: ended("expiresAt") }), () => prisma.verificationToken.deleteMany({ where: ended("expiresAt") })),
    rows(() => prisma.passwordResetToken.count({ where: ended("expiresAt") }), () => prisma.passwordResetToken.deleteMany({ where: ended("expiresAt") })),
    rows(() => prisma.oAuthAuthorizationCode.count({ where: ended("expiresAt") }), () => prisma.oAuthAuthorizationCode.deleteMany({ where: ended("expiresAt") })),
    rows(() => prisma.oAuthToken.count({ where: tokens }), () => prisma.oAuthToken.deleteMany({ where: tokens })),
    rows(() => prisma.administrationEvent.count({ where: keyChecksWhere }), () => prisma.administrationEvent.deleteMany({ where: keyChecksWhere })),
    rows(() => prisma.administrationEvent.count({ where: keyAlertsWhere }), () => prisma.administrationEvent.deleteMany({ where: keyAlertsWhere })),
    rows(() => prisma.mailing.count({ where: mailingsWhere }), () => prisma.mailing.deleteMany({ where: mailingsWhere })),
    // Rate-limit counters older than a day are past every window (security review 2026-10-04).
    cleanRateLimits(now, { dryRun }),
    // Beteendeanalys (2026-10-07): counters older than the chosen retention time.
    getAnalyticsSettings().then((settings) => pruneCounters(now, settings.retentionMonths, { dryRun })),
    // Säkerhetslogg (2026-10-10): 12 months, whatever the companies choose for their history.
    pruneSecurityLog(now, undefined, { dryRun }),
    rows(() => prisma.machineEvent.count({ where: machineEventsWhere }), () => prisma.machineEvent.deleteMany({ where: machineEventsWhere })),
    rows(() => prisma.machineRawSample.count({ where: rawSamplesWhere }), () => prisma.machineRawSample.deleteMany({ where: rawSamplesWhere })),
    rows(() => prisma.machineRawDedupe.count({ where: rawDedupesWhere }), () => prisma.machineRawDedupe.deleteMany({ where: rawDedupesWhere })),
    rows(() => prisma.machineDaySummary.count({ where: daySummariesWhere }), () => prisma.machineDaySummary.deleteMany({ where: daySummariesWhere })),
    rows(() => prisma.screenPairing.count({ where: pairingsWhere }), () => prisma.screenPairing.deleteMany({ where: pairingsWhere })),
  ]);
  return {
    verification, passwordReset, oauthCodes, oauthTokens,
    keyChecks, keyAlerts, mailings, rateLimits, analytics, ...security, machineEvents,
    machineRawSamples, machineRawDedupes, machineDaySummaries, screenPairings,
  };
}
