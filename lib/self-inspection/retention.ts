import { swedishDayKey } from "@/lib/swedish-time";
import { retentionCutoff } from "@/lib/workflow/history-retention";
import { INCIDENT_TYPES, isIncidentType } from "./incidents";

/**
 * Lagringstid för avvikelser, tillbud och olycksfall (the owner's decision 2026-11-04; reasons and sources in
 * docs/beslut/juridik-drift-och-kvalitet.md). Counted from when the entry was closed; an open entry is never touched:
 * - Elinstallation, förbättring and riskobservation: the whole entry goes after 5 years.
 * - Tillbud and olycksfall: the whole entry goes after 10 years. After 3 years what can name or describe a person goes
 *   (names, Beskrivning, Vad hände, Uppföljning, the note, comments, photos, the title); type, dates, marks, Varför and Åtgärd stay.
 * - Spara tills vidare stops both for one entry, for a claim. Fixed values for now: a company setting is left for later.
 * Pure rules shared by the nightly job, the view, the export and the tests; no database here. Cloud only: a Local file is the company's own.
 */
export const DEVIATION_RETENTION_MONTHS = { general: 60, incident: 120, personalData: 36 } as const;
/** How long before a step the log says it is coming. */
export const DEVIATION_RETENTION_WARNING_DAYS = 90;
/** No entry's time starts before the rule existed, so what was closed earlier never goes sooner than the rule promises. */
export const DEVIATION_RETENTION_RULE_START = new Date("2026-11-04T00:00:00.000Z");
/** What stands in reportedById when the reporter's link is gone: no account has this id, so nobody reads the entry as its reporter. */
export const DEVIATION_RETENTION_SYSTEM_USER = "system:retention";
export const DEVIATION_PERSONAL_DATA_REMOVED_TITLE = "Uppgifter borttagna";
export const DEVIATION_PERSONAL_DATA_REFUSAL = "Namn, text och bilder är borttagna enligt lagringstiden. Den här avvikelsen kan inte ändras.";
/** The one line in the log and the PDF. */
export const DEVIATION_RETENTION_TEXT = "Klara avvikelser sparas i 5 år. Tillbud och olycksfall sparas i 10 år, men namn, text om händelsen och bilder tas bort efter 3 år.";
export const DEVIATION_RETENTION_HOLD_HINT = "Pågår ett krav? Välj Spara tills vidare.";

export type DeviationRetentionCutoffs = { general: Date | null; incident: Date | null; personalData: Date | null };

const cutoffOf = (months: number, now: Date) => {
  const cutoff = retentionCutoff(months, now);
  return cutoff > DEVIATION_RETENTION_RULE_START ? cutoff : null;
};
/** An entry closed before a cutoff has passed that step; null means the step cannot apply to anything yet (the rule is too young). */
export const deviationRetentionCutoffs = (now = new Date()): DeviationRetentionCutoffs => ({
  general: cutoffOf(DEVIATION_RETENTION_MONTHS.general, now),
  incident: cutoffOf(DEVIATION_RETENTION_MONTHS.incident, now),
  personalData: cutoffOf(DEVIATION_RETENTION_MONTHS.personalData, now),
});

/** The whole entry goes (a database filter), or null when nothing can. Always bound to one company; open and held entries never match. */
export function deviationRemovalWhere(organizationId: string, cutoffs: DeviationRetentionCutoffs) {
  const steps = [
    // Every type but the incidents, the company's own types ("OWN:<namn>") included.
    ...(cutoffs.general ? [{ type: { notIn: [...INCIDENT_TYPES] as string[] }, closedAt: { lt: cutoffs.general } }] : []),
    ...(cutoffs.incident ? [{ type: { in: [...INCIDENT_TYPES] as string[] }, closedAt: { lt: cutoffs.incident } }] : []),
  ];
  return steps.length ? { organizationId, status: "DONE", retentionHoldAt: null, OR: steps } : null;
}

/** A near miss's or an accident's names and text go (a database filter), or null when nothing can. Done once per entry. */
export function deviationPersonalDataWhere(organizationId: string, cutoffs: DeviationRetentionCutoffs) {
  if (!cutoffs.personalData) return null;
  return { organizationId, status: "DONE", retentionHoldAt: null, personalDataRemovedAt: null, type: { in: [...INCIDENT_TYPES] as string[] }, closedAt: { lt: cutoffs.personalData } };
}

/** What the entry looks like after the 3 years: what can name or describe a person is gone. Type, dates, marks, Varför and Åtgärd stay. */
export const personalDataRemovedPatch = (now: Date) => ({
  title: DEVIATION_PERSONAL_DATA_REMOVED_TITLE, description: "", whatHappened: "", followUp: "", doneNote: "", sourceTitle: "",
  reportedById: DEVIATION_RETENTION_SYSTEM_USER, responsibleUserId: null, closedById: null, closedByName: "", reportedToAuthorityById: null,
  personalDataRemovedAt: now,
});

const addMonths = (from: Date, months: number) => {
  const next = new Date(from);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  next.setUTCDate(Math.min(day, new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()));
  return next;
};

export type DeviationRetentionEntry = { type?: string | null; status: string; closedAt?: string | Date | null; retentionHoldAt?: string | Date | null; personalDataRemovedAt?: string | Date | null };

/** When an entry's steps come; null for an open or held entry, where nothing is coming. */
export function deviationRetentionDates(entry: DeviationRetentionEntry) {
  if (entry.status !== "DONE" || !entry.closedAt || entry.retentionHoldAt) return null;
  const closed = new Date(entry.closedAt);
  const start = closed > DEVIATION_RETENTION_RULE_START ? closed : DEVIATION_RETENTION_RULE_START;
  if (!isIncidentType(entry.type)) return { personalData: null, removal: addMonths(start, DEVIATION_RETENTION_MONTHS.general) };
  return { personalData: entry.personalDataRemovedAt ? null : addMonths(start, DEVIATION_RETENTION_MONTHS.personalData), removal: addMonths(start, DEVIATION_RETENTION_MONTHS.incident) };
}

/** The line on one entry, or null for an open one. `warning`: the next step is within DEVIATION_RETENTION_WARNING_DAYS. */
export function deviationRetentionLine(entry: DeviationRetentionEntry, now = new Date()): { text: string; warning: boolean } | null {
  if (entry.status !== "DONE") return null;
  const removed = entry.personalDataRemovedAt ? `Namn, text och bilder togs bort ${swedishDayKey(new Date(entry.personalDataRemovedAt))}. ` : "";
  if (entry.retentionHoldAt) return { text: `${removed}Sparas tills vidare.`, warning: false };
  const dates = deviationRetentionDates(entry);
  if (!dates) return null;
  const next = dates.personalData ?? dates.removal;
  const warning = next.getTime() - now.getTime() <= DEVIATION_RETENTION_WARNING_DAYS * 86_400_000;
  const steps = dates.personalData
    ? `Namn, text och bilder tas bort ${swedishDayKey(dates.personalData)}. Resten tas bort ${swedishDayKey(dates.removal)}.`
    : `${removed ? "Resten" : "Avvikelsen"} tas bort ${swedishDayKey(dates.removal)}.`;
  return { text: `${removed}${steps}`, warning };
}

/** The history line of one night: counts only, never a name, a title or a number. */
export function deviationRetentionDetail(counts: { removed: number; personalData: number; files: number }) {
  return `Avvikelser rensades efter lagringstiden: ${counts.removed} ${counts.removed === 1 ? "post togs bort" : "poster togs bort"}, ${counts.personalData} ${counts.personalData === 1 ? "tillbud eller olycksfall" : "tillbud och olycksfall"} utan namn och text, ${counts.files} ${counts.files === 1 ? "fil" : "filer"}.`;
}
