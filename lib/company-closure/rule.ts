import type { CloudAgreementState } from "@/lib/extensions/types";
import { formatSwedish, swedishDayDifference, swedishDayKey } from "@/lib/swedish-time";

/**
 * Radering efter avslut (2026-10-10). The terms (punkt 11) and the privacy policy promise: after serverlagring ends
 * the customer can export for 30 days, then the data is removed from active storage within 30 days (backups roll out
 * within 90 days). Until now Workflow only erased by hand; this is the rule for doing it automatically. Pure: who is
 * counted down, the dates, which notice is due, and when a company is due for erasure. The job and the views are in
 * lib/company-closure/server.ts.
 *
 * "Avslutat" means exactly: billing says ENDED (ee/billing/cloud-agreement-end.ts – billing-managed, no valid Cloud right,
 * no open subscription, no unpaid Cloud invoice). A payment block, a company without billing (Local, Community, demo,
 * QA), the installation's own company and a company where the superadmin is a member never count down. Without ee/
 * billing always says NOT_BILLING, so nothing is ever erased automatically.
 */
export const EXPORT_DAYS = 30;
/** Reminders this many Swedish calendar days before the erasure date (day 23 and the day before). */
export const REMINDER_DAYS = [7, 1] as const;
/** At most this many companies are erased in one run; the rest wait for the next night. */
export const ERASE_LIMIT_PER_RUN = 3;
/** A postponement may reach at most this far ahead. */
export const MAX_POSTPONE_DAYS = 366;
const DAY_MS = 86_400_000;

export const DAY_0 = "DAY_0";
export type ReminderStage = "REMINDER_7" | "REMINDER_1";
export const reminderKey = (stage: ReminderStage, dueAt: Date) => `${stage}|${swedishDayKey(dueAt)}`;

export type ClosureCompany = {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  storageMode: "LOCAL" | "HINTEK_CLOUD";
  /** The installation's own company (lib/branding isHintekOrganization), decided by the caller. */
  hintek: boolean;
  /** An active member of the company is the installation's superadmin. */
  superadminMember: boolean;
};

export type ClosureRow = {
  organizationId: string;
  endedAt: Date;
  exportUntil: Date;
  postponedUntil: Date | null;
  noticesSent: string[];
  firstNoticeAt: Date | null;
};

/** A company erased before keeps its row renamed and inactive (lib/auth/erasure.ts); it is never erased again. */
export const isErasedCompany = (company: Pick<ClosureCompany, "id" | "slug">) => company.slug === `raderat-${company.id}`;

/** Why a company never counts down, or null. Checked before billing is asked, and again just before erasure. */
export function closureExclusion(company: ClosureCompany): string | null {
  if (isErasedCompany(company)) return "Redan raderat";
  if (company.hintek) return "Installationens eget företag";
  if (company.superadminMember) return "Superadmin är medlem";
  const slug = company.slug.toLowerCase();
  if (slug.startsWith("qa-") || slug === "demo" || slug.startsWith("demo-")) return "Test- eller demoföretag";
  // A Local company keeps its work in its own file; ending Cloud never erases its accounts.
  if (company.storageMode !== "HINTEK_CLOUD") return "Inte Cloud";
  return null;
}

/** The erasure date: the end of the export time, or the postponement when that is later. */
export function closureDueAt(row: Pick<ClosureRow, "exportUntil" | "postponedUntil">) {
  return row.postponedUntil && row.postponedUntil > row.exportUntil ? row.postponedUntil : row.exportUntil;
}

/**
 * The export time starts at the first notice, never before: the customer always has the full 30 days from being told,
 * even when the job sees the end late (for example the first night after this was switched on). The end date billing
 * reported is kept for the record.
 */
export const exportUntilFrom = (noticeAt: Date) => new Date(noticeAt.getTime() + EXPORT_DAYS * DAY_MS);

export type ClosureStep =
  | { kind: "none" }
  /** A countdown that no longer applies (a valid agreement again, a payment problem, Local, excluded): the row goes. */
  | { kind: "cancel"; reason: string }
  /** The agreement has ended and no countdown runs yet: start it and send the day-0 notice. */
  | { kind: "start"; endedAt: Date; exportUntil: Date }
  | { kind: "remind"; stage: ReminderStage; key: string; dueAt: Date }
  | { kind: "wait"; dueAt: Date }
  /** The date has passed: erased when the instance switch is on, otherwise only listed. */
  | { kind: "due"; dueAt: Date };

const cancelReason = (agreement: CloudAgreementState) =>
  agreement.state === "ACTIVE" ? "Företaget har ett giltigt Cloud-avtal igen."
    : agreement.state === "UNSETTLED" ? "Avtalet har en öppen betalning eller ett öppet abonnemang."
      : "Företaget har inte längre ett Cloud-avtal hos faktureringen.";

/** What the job should do with one company now. */
export function closureStep(input: { company: ClosureCompany; agreement: CloudAgreementState | null; row: ClosureRow | null; now: Date }): ClosureStep {
  const { company, agreement, row, now } = input;
  const excluded = closureExclusion(company);
  if (excluded || !agreement || agreement.state !== "ENDED") {
    if (!row) return { kind: "none" };
    return { kind: "cancel", reason: excluded ? `Undantaget: ${excluded}.` : agreement ? cancelReason(agreement) : "Okänt avtalsläge." };
  }
  if (!row) return { kind: "start", endedAt: agreement.endedAt, exportUntil: exportUntilFrom(now) };
  const dueAt = closureDueAt(row);
  // Never due before the day-0 notice is recorded and the full export time from it has passed.
  const toldLongEnough = row.firstNoticeAt && row.noticesSent.includes(DAY_0) && now.getTime() >= row.firstNoticeAt.getTime() + EXPORT_DAYS * DAY_MS;
  if (now >= dueAt && toldLongEnough) return { kind: "due", dueAt };
  const daysLeft = swedishDayDifference(now, dueAt);
  // Only the most pressing reminder that applies; one missed night never sends two at once.
  const stage: ReminderStage | null = daysLeft <= REMINDER_DAYS[1] ? "REMINDER_1" : daysLeft <= REMINDER_DAYS[0] ? "REMINDER_7" : null;
  if (stage && !row.noticesSent.includes(reminderKey(stage, dueAt))) {
    // The 7-day reminder is pointless once the 1-day one went out for the same date.
    if (!(stage === "REMINDER_7" && row.noticesSent.includes(reminderKey("REMINDER_1", dueAt)))) return { kind: "remind", stage, key: reminderKey(stage, dueAt), dueAt };
  }
  return { kind: "wait", dueAt };
}

/** The date in the notices, e.g. "9 november 2026" (Swedish time). */
export const closureDateText = (value: Date) => formatSwedish(value, { day: "numeric", month: "long", year: "numeric" });

/** The notice the owners and admins get (bell and e-mail), the product owner's wording. */
export function closureNoticeText(dueAt: Date, now?: Date) {
  // Past the date while automatic erasure is still off (the superadmin has not turned it on yet): say so plainly.
  if (now && now >= dueAt) return `Ert Cloud-avtal har upphört och exporttiden gick ut ${closureDateText(dueAt)}. Företagets data kan raderas när som helst. Exportera det ni vill spara nu.`;
  return `Ert Cloud-avtal har upphört. Exportera det ni vill spara före ${closureDateText(dueAt)}. Därefter raderas företagets data.`;
}

export function closureMailSubject(kind: "start" | ReminderStage) {
  return kind === "start" ? "Ert Cloud-avtal har upphört" : kind === "REMINDER_7" ? "Påminnelse: företagets data raderas om en vecka" : "Påminnelse: företagets data raderas i morgon";
}

/** A postponement must move the date later, with a reason, and not further than a year ahead. Returns an error text or null. */
export function postponeProblem(input: { until: Date | null; reason: string; currentDueAt: Date; now: Date }) {
  if (!input.until || !Number.isFinite(input.until.getTime())) return "Ange ett giltigt datum.";
  if (input.reason.trim().length < 3) return "Skriv ett skäl till uppskjutningen.";
  if (input.until <= input.currentDueAt) return "Det nya datumet måste vara senare än det nuvarande raderingsdatumet.";
  if (input.until.getTime() > input.now.getTime() + MAX_POSTPONE_DAYS * DAY_MS) return "Raderingen kan skjutas upp högst ett år framåt.";
  return null;
}
