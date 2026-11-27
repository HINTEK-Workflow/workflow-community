// History kept for a selectable time and deleted by hand (2026-09-30). Pure rules shared by the page, the server,
// the nightly job and the tests; no Prisma here.

/** Months a company can keep its history; null keeps it until someone deletes it by hand. */
export const HISTORY_RETENTION_CHOICES = [null, 6, 12, 24, 36, 60, 84, 120] as const;
export type HistoryRetentionMonths = (typeof HISTORY_RETENTION_CHOICES)[number];

export function retentionLabel(months: HistoryRetentionMonths) {
  if (months === null) return "Tills vidare (raderas bara för hand)";
  if (months < 12) return `${months} månader`;
  return months === 12 ? "1 år" : `${months / 12} år`;
}

/**
 * The history that may be deleted. Only work history: the current state of every task, control, project and planning
 * is never touched, and the latest version of a task or control is always kept. Not included: project decisions
 * (documentation), legal acceptances, orders, invoices, payments, credits and the AI ledger (bookkeeping and evidence).
 */
export const HISTORY_CATEGORIES = [
  { key: "versions", label: "Tidigare versioner av uppgifter, protokoll och kontroller", note: "Den senaste versionen behålls alltid." },
  { key: "project", label: "Projekthistorik", note: "Händelser som skapat, kopplat och arkiverat. Beslutsloggen behålls." },
  { key: "planning", label: "Planeringshistorik", note: "Ändringar av planerade aktiviteter." },
  { key: "time", label: "Ändringshistorik för tidrapporter", note: "Själva tidposterna behålls." },
  { key: "administration", label: "Administrationshistorik", note: "Medlemmar, inställningar, nycklar, arbetstider och formulärändringar." },
  { key: "ai", label: "Chattar med Workflow AI", note: "Hela konversationer vars senaste meddelande är äldre. Kostnadsloggen för AI-körningar behålls." },
] as const;
export type HistoryCategory = (typeof HISTORY_CATEGORIES)[number]["key"];
export const HISTORY_CATEGORY_KEYS = HISTORY_CATEGORIES.map((category) => category.key) as HistoryCategory[];

export function isRetentionChoice(value: unknown): value is HistoryRetentionMonths {
  return HISTORY_RETENTION_CHOICES.includes(value as HistoryRetentionMonths);
}

/** The moment before which history is removed: the same day and time, the given number of months back. */
export function retentionCutoff(months: number, now = new Date()) {
  const cutoff = new Date(now);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  // Stay within the target month (31 March minus one month is the last of February, not 3 March).
  const last = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day, last));
  return cutoff;
}

/** A manual deletion takes a calendar day (YYYY-MM-DD, Swedish time is close enough at midnight UTC) in the past. */
export function manualCutoffProblem(day: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Välj ett datum.";
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return "Datumet finns inte.";
  if (date.getTime() > now.getTime()) return "Datumet måste ligga bakåt i tiden.";
  if (date.getUTCFullYear() < 2000) return "Datumet är för tidigt.";
  return null;
}

export type HistoryCounts = Record<HistoryCategory, number>;
export const emptyCounts = (): HistoryCounts => ({ versions: 0, project: 0, planning: 0, time: 0, administration: 0, ai: 0 });
export const countTotal = (counts: Partial<HistoryCounts>) => Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);

/** The detail line written to the company's administration history after a deletion (counts only, no content). */
export function purgeDetail(kind: "manual" | "retention", before: Date, counts: HistoryCounts) {
  const parts = HISTORY_CATEGORIES.filter((category) => counts[category.key]).map((category) => `${category.label.toLowerCase()}: ${counts[category.key]}`);
  const what = parts.length ? parts.join(", ") : "inget att radera";
  return `${kind === "manual" ? "Historik raderad för hand" : "Historik raderad enligt lagringstiden"} (äldre än ${before.toISOString().slice(0, 10)}) – ${what}.`;
}
