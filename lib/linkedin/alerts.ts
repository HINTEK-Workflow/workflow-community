/**
 * Larm för LinkedIn (2026-11-11, like Facebook och Instagram's, lib/meta/alerts.ts): the nightly job (keys:alerts) asks
 * LinkedIn about every company's token – renewing it where LinkedIn gave a refresh token – and mails the company's admins a
 * week before the token runs out and when the connection has stopped working, once per state and token. Pure rules here;
 * lib/linkedin/alerts-server.ts does the work.
 */
export type LinkedInAlertState = "expiring" | "invalid";
const DAY = 86_400_000;
export const LINKEDIN_ALERT_DAYS = 7;

type Row = { status: string; accessTokenExpiresAt: Date | null; refreshTokenCipher?: string | null; refreshTokenExpiresAt?: Date | null };

/** What the admins should hear about now, or null. A token LinkedIn renews by itself is only told about when renewing ends. */
export function linkedInAlertState(row: Row, now = new Date()): LinkedInAlertState | null {
  if (row.status === "invalid") return "invalid";
  const end = row.refreshTokenCipher ? row.refreshTokenExpiresAt ?? null : row.accessTokenExpiresAt;
  const access = row.accessTokenExpiresAt;
  if (access && access.getTime() <= now.getTime() && !row.refreshTokenCipher) return "invalid";
  if (end && end.getTime() <= now.getTime()) return "invalid";
  if (end && end.getTime() - now.getTime() <= LINKEDIN_ALERT_DAYS * DAY) return "expiring";
  return null;
}

/** The mark that a mail was sent: per company, state and token (a new token is a new mark). */
export const linkedInAlertAction = (organizationId: string, state: LinkedInAlertState, tokenTag: string) => `linkedin_alert:${organizationId}:${state}:${tokenTag.slice(-16)}`;

/** The mail's subject and first line, short and plain. */
export function linkedInAlertText(state: LinkedInAlertState, row: Row & { authorName: string | null }) {
  const day = (date: Date | null | undefined) => (date ? date.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" }) : null);
  const where = row.authorName ? ` (${row.authorName})` : "";
  if (state === "invalid") return { subject: "LinkedIn fungerar inte", line: `Kopplingen till LinkedIn${where} fungerar inte längre. Inget kan publiceras där förrän den är kopplad igen.` };
  const end = row.refreshTokenCipher ? row.refreshTokenExpiresAt : row.accessTokenExpiresAt;
  return { subject: "LinkedIn: kopplingen går ut snart", line: `Kopplingen till LinkedIn${where} går ut ${day(end) ?? "snart"}.` };
}
