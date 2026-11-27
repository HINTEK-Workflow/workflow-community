/**
 * Larm för Facebook och Instagram (2026-11-10): the nightly job (keys:alerts) asks Meta about every company's token and
 * mails the company's admins a week before the token or Meta's data access runs out, and when the connection has stopped
 * working – once per state and token, never every night. Pure rules here; lib/meta/alerts-server.ts does the work.
 */
export type MetaAlertState = "expiring" | "invalid";
const DAY = 86_400_000;
export const META_ALERT_DAYS = 7;

type Row = { status: string; userTokenExpiresAt: Date | null; dataAccessExpiresAt: Date | null };

/** What the admins should hear about now, or null. */
export function metaAlertState(row: Row, now = new Date()): MetaAlertState | null {
  if (row.status === "invalid") return "invalid";
  const dates = [row.userTokenExpiresAt, row.dataAccessExpiresAt].filter((date): date is Date => Boolean(date));
  if (dates.some((date) => date.getTime() <= now.getTime())) return "invalid";
  if (dates.some((date) => date.getTime() - now.getTime() <= META_ALERT_DAYS * DAY)) return "expiring";
  return null;
}

/**
 * The mark that a mail was sent: per company, state and token (a new token is a new mark, so the same state on a later token is
 * told again; the same state on the same token never twice).
 */
export const metaAlertAction = (organizationId: string, state: MetaAlertState, tokenTag: string) => `meta_alert:${organizationId}:${state}:${tokenTag.slice(-16)}`;

/** The mail's subject and first line, short and plain. */
export function metaAlertText(state: MetaAlertState, row: Row & { pageName: string | null }) {
  const day = (date: Date | null) => (date ? date.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" }) : null);
  const page = row.pageName ? ` (${row.pageName})` : "";
  if (state === "invalid") return { subject: "Facebook och Instagram fungerar inte", line: `Kopplingen till Facebook och Instagram${page} fungerar inte längre. Inget kan publiceras förrän en ny token är inlagd.` };
  const soonest = [row.userTokenExpiresAt, row.dataAccessExpiresAt].filter((date): date is Date => Boolean(date)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  return { subject: "Facebook och Instagram: token går ut snart", line: `Token för Facebook och Instagram${page} går ut ${day(soonest) ?? "snart"}.` };
}
