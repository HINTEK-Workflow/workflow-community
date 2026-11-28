// Behörighetsstyrning (K2, beslut 2026-11-28, kvalitetsmålen för informationssäkerhet): the rules without a database, so they
// can be tested alone. Everything is off from the start; a small company that does nothing sees no difference.

// ---------- K2.3 Supportåtkomst med medgivande ----------

/** The lengths the company's admin chooses between: 1 hour, 24 hours (the default) and 7 days. */
export const SUPPORT_ACCESS_HOURS = [1, 24, 168] as const;
export type SupportAccessHours = (typeof SUPPORT_ACCESS_HOURS)[number];
export const SUPPORT_ACCESS_DEFAULT_HOURS: SupportAccessHours = 24;
export const SUPPORT_ACCESS_HOURS_LABEL: Record<SupportAccessHours, string> = { 1: "1 timme", 24: "24 timmar", 168: "7 dygn" };
export const isSupportAccessHours = (value: unknown): value is SupportAccessHours => (SUPPORT_ACCESS_HOURS as readonly unknown[]).includes(value);

export const supportAccessExpiry = (hours: SupportAccessHours, now = new Date()) => new Date(now.getTime() + hours * 3_600_000);

export type SupportGrantLike = { expiresAt: Date; revokedAt: Date | null };
export type SupportGrantState = "active" | "expired" | "revoked";

/** Revoked wins over expired, so a grant taken back early is always told as taken back. */
export function supportGrantState(grant: SupportGrantLike, now = new Date()): SupportGrantState {
  if (grant.revokedAt) return "revoked";
  return grant.expiresAt.getTime() > now.getTime() ? "active" : "expired";
}

/** The open grant among a company's grants, or null. A missing, revoked or expired grant never opens anything. */
export function openSupportGrant<T extends SupportGrantLike>(grants: readonly T[], now = new Date()): T | null {
  return grants.filter((grant) => supportGrantState(grant, now) === "active").sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0] ?? null;
}

/**
 * What support may read during a grant: a fixed list, each part a bounded read-only page. Nothing here writes, and a part
 * that is not on the list is refused.
 */
export const SUPPORT_PARTS = ["overview", "members", "places", "machines", "work_orders", "forms"] as const;
export type SupportPart = (typeof SUPPORT_PARTS)[number];
export const SUPPORT_PART_LABEL: Record<SupportPart, string> = {
  overview: "Översikt och inställningar",
  members: "Användare och roller",
  places: "Platser",
  machines: "Maskiner",
  work_orders: "Arbetsorder",
  forms: "Formulär",
};
export const isSupportPart = (value: unknown): value is SupportPart => (SUPPORT_PARTS as readonly unknown[]).includes(value);

// ---------- K2.4 Granska behörigheter ----------

/** The anchor of the review on Användare, which Översikt's reminder links to. */
export const ACCESS_REVIEW_ANCHOR = "granska-behorigheter";

/** The review is due every quarter: three months after the last sign-off (never signed: counted from the company's start). */
export const ACCESS_REVIEW_MONTHS = 3;

export function accessReviewDueAt(lastReviewedAt: Date | null, since: Date) {
  // In UTC, so a change to or from summer time never moves the hour.
  const due = new Date(lastReviewedAt ?? since);
  const day = due.getUTCDate();
  due.setUTCMonth(due.getUTCMonth() + ACCESS_REVIEW_MONTHS);
  // 30 November + 3 months is the last day of February, not 2 March.
  if (due.getUTCDate() < day) due.setUTCDate(0);
  return due;
}

/** Whether Översikt reminds the admin now: only with the reminder on, and never before the first quarter has passed. */
export function accessReviewDue(input: { reminderOn: boolean; lastReviewedAt: Date | null; since: Date }, now = new Date()) {
  return input.reminderOn && accessReviewDueAt(input.lastReviewedAt, input.since).getTime() <= now.getTime();
}

/** A member's permissions in words: the role for an admin, a preset's name, or own permissions with a count. */
export function permissionSummary(role: string, grants: readonly string[], presets: readonly { label: string; profile: { grants: readonly string[] } }[], total: number) {
  if (role === "OWNER") return "Ägare: allt i företaget";
  if (role === "ADMIN") return "Administratör: allt i företaget";
  const own = new Set(grants);
  const preset = presets.find((item) => item.profile.grants.length === own.size && item.profile.grants.every((grant) => own.has(grant)));
  return preset ? preset.label : `Egna behörigheter (${own.size} av ${total})`;
}

export const ROLE_LABEL: Record<string, string> = { OWNER: "Ägare", ADMIN: "Administratör", MEMBER: "Medarbetare" };

/** One row of the review, as it is shown and exported: what it is, its name, who it acts as, what it may, and its dates. */
export type AccessReviewRow = { type: string; name: string; who: string; rights: string; status: string; validUntil: string; lastUsed: string };
export const ACCESS_REVIEW_COLUMNS = ["Typ", "Namn", "Person", "Behörighet", "Status", "Gäller till", "Senast använd"] as const;

/** The review as CSV for Excel (semicolons, every cell quoted and protected against formulas by csvCell). */
export function accessReviewCsv(rows: readonly AccessReviewRow[], cell: (value: string) => string) {
  const lines = [ACCESS_REVIEW_COLUMNS.map(cell).join(";"), ...rows.map((row) => [row.type, row.name, row.who, row.rights, row.status, row.validUntil, row.lastUsed].map(cell).join(";"))];
  // A byte-order mark, so Excel reads å, ä and ö right.
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ---------- K2.5 Nycklar med minsta behörighet ----------

/**
 * Whether a machine source's key may write an event for this machine part. An empty list is no limit (as before K2.5); with a
 * list, an event on another part – or on no part at all – is refused, so a limited key can never write anywhere else.
 */
export function machinePartAllowed(allowed: readonly string[] | null | undefined, partId: string | null) {
  if (!allowed?.length) return true;
  return partId !== null && allowed.includes(partId);
}

// ---------- K2.6 Krav på tvåsteg ----------

/**
 * Whether a sign-in must set up two-step verification before it reaches the app: required (a superadmin, or a company whose
 * admin turned it on), and neither the app's own code nor a sign-in that is two steps in itself (a passkey, or Microsoft
 * when Microsoft's verified token says its own multi-factor was done). The loopback QA superadmin is the one exception.
 */
export function twoFactorSetupNeeded(input: { required: boolean; hasTotp: boolean; strongMethod: boolean; qaSuperadmin?: boolean }) {
  if (input.qaSuperadmin) return false;
  return input.required && !input.hasTotp && !input.strongMethod;
}
