import { hasWorkflowPermission, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { canSeePrices } from "@/lib/workflow/material-prices";
import { parseAmount, type MaterialRow } from "@/lib/workflow/expenses";
import { effectiveQuoteStatus, type QuoteStatus } from "@/lib/quotes/model";
import { invoiceBasisTotals, invoiceSourceKeys, linesFromWork, timeSourceKey } from "@/lib/invoice-basis/model";
import type { CreditSummary } from "@/lib/credits/wallet-summary";
import { organizationModuleOn } from "@/lib/workflow/modules";

/**
 * Översikt → Ekonomi (2026-10-28): "gå från ofakturerad tid till förslag på fakturaunderlag; en samlad lista över
 * fakturaunderlag; offertuppföljning och kommande giltighetsdatum; företagets egna ekonomiska mål; skilj uppskattningar från
 * verkliga värden; rätta AI-krediter …; visa inte kassaflöde eller förfallna fakturor utan tillförlitlig datakälla.
 * Återanvänd befintliga fakturerings- och offertfunktioner – inget parallellt ekonomisystem."
 * Pure rules shared by the server (lib/overview/economy-server.ts), the tab and the tests. Nothing here invents a figure:
 * Fakturerat is the invoiced bases (verkligt), Ofakturerad tid is finished time no basis has taken × the company's own
 * hourly rate (uppskattning), the quotes are the quotes. No cash flow, no overdue invoices and no margin – Workflow has no
 * reliable source for them. "Utfall mot offert" is left out too: a basis does not say which quote it settles, so a
 * comparison would be a guess.
 */

// ---------- rights ----------

export type EconomyCaller = { admin: boolean; workflowPermissions: WorkflowPermissionProfile; organization?: { disabledModules?: readonly string[] | null } | null };
export type EconomyAccess = {
  /** The tab and its summary: admin or Ekonomi – läsa (canViewEconomy). */
  view: boolean;
  /** Kronor: the price right (canSeePrices); without it the tab shows counts and hours only. */
  prices: boolean;
  /** Open and handle bases (Offerter – läsa), and make new ones (Offerter – redigera): lib/invoice-basis/server.ts. */
  readBases: boolean;
  createBases: boolean;
  /** Open a quote from the follow-up (Offerter – läsa). */
  readQuotes: boolean;
  /** Which unbilled rows may be named and opened: a work order's or a project's. */
  readWorkOrders: boolean;
  readProjects: boolean;
};

export function economyAccess(caller: EconomyCaller): EconomyAccess {
  const can = (subject: Parameters<typeof hasWorkflowPermission>[1], action: "read" | "edit") => caller.admin || hasWorkflowPermission(caller.workflowPermissions, subject, action);
  const readQuotes = can("quotes", "read");
  return {
    view: can("economy", "read"),
    prices: canSeePrices({ admin: caller.admin, permissions: caller.workflowPermissions }),
    // Företagets moduler (0.39.0): the right alone never shows a module that is off. The price right follows no module.
    readBases: readQuotes && organizationModuleOn(caller.organization, "invoicing"), createBases: can("quotes", "edit") && organizationModuleOn(caller.organization, "invoicing"),
    readQuotes: readQuotes && organizationModuleOn(caller.organization, "quotes"),
    readWorkOrders: can("work-order", "read"), readProjects: can("projects", "read"),
  };
}

// ---------- verkligt och uppskattat ----------

/** Every figure says what it is: an invoiced or decided amount is "Verkligt", a computed one "Uppskattning". */
export type FigureKind = "actual" | "estimate";
export const FIGURE_KIND_LABEL: Record<FigureKind, string> = { actual: "Verkligt", estimate: "Uppskattning" };

/** The company's hourly rate (Priser och offert), or null when none is set or it cannot be read. */
export function hourlyRateOf(text: string | null | undefined): number | null {
  const value = parseAmount(text ?? "");
  return value === null || value <= 0 ? null : value;
}

/** Hours × the hourly rate in whole kronor; null without a rate (the tab then shows the hours alone). */
export function estimateValue(seconds: number, rate: number | null): number | null {
  if (rate === null || !Number.isFinite(seconds) || seconds <= 0) return rate === null ? null : 0;
  return Math.round((seconds / 3600) * rate);
}

/** "12,5 h" – hours with one decimal, as the time pages say it. */
export function hoursText(seconds: number): string {
  const hours = Math.round((Math.max(0, seconds) / 3600) * 10) / 10;
  return `${hours.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} h`;
}

// ---------- ofakturerad tid ----------

/** What the unbilled query looks for: a time entry is taken by a basis exactly when this key + its id is a source. */
export const TIME_SOURCE_PREFIX = timeSourceKey("");

/** A finished time entry no basis has taken (the query's rule, for the tests and the documentation). */
export function isUnbilledEntry(entry: { id: string; durationSec: number; endedAt: Date | string | null }, taken: ReadonlySet<string>): boolean {
  return entry.endedAt !== null && entry.durationSec > 0 && !taken.has(timeSourceKey(entry.id));
}

/** One group of the query: a completed work order outside projects, or a project (its completed work orders and own time). */
export type UnbilledGroup = { kind: "task" | "project"; id: string; seconds: number; entries: number; oldest: Date;
  /** The group's finished time a basis has already taken (2026-10-29: "fakturerat av upparbetat"); 0 when left out. */
  invoicedSeconds?: number;
  /** Material and expense rows on its completed work orders that no basis has taken (2026-10-29); 0 when left out. */
  materialRows?: number;
  /** Their amount excl. VAT as the proposal counts it (the rows' own prices); null without the price right. */
  materialNet?: number | null };
export type UnbilledRow = {
  kind: "task" | "project"; id: string; title: string; customer: string;
  seconds: number; entries: number; oldestDays: number;
  /** Finished time on the same job or project that a basis has already taken. */
  invoicedSeconds: number;
  /** Material and expense rows not yet on a basis. */
  materialRows: number;
  /** Hours × timpris plus the material rows' own prices (uppskattning); null without the price right, or with time but no rate. */
  estimate: number | null;
  /** Where the row opens: the work order or the project (only readable rows are listed). */
  href: string;
  /** Skapa underlag: opens the existing proposal for this job or project (Offerter – redigera). */
  canCreate: boolean;
};

export type UnbilledNames = { tasks: ReadonlyMap<string, { title: string; customer: string }>; projects: ReadonlyMap<string, { title: string; customer: string }> };

/**
 * The rows the person may see, oldest first: a work order needs Arbetsorder – läsa and a project Projekt – läsa (the
 * proposal's own rule); the others are counted in `hidden` but stay in the company's totals. A group whose job or
 * project is gone since the query is left out.
 */
export function unbilledRows(groups: readonly UnbilledGroup[], names: UnbilledNames, access: Pick<EconomyAccess, "prices" | "createBases" | "readWorkOrders" | "readProjects">, rate: number | null, now: Date): { rows: UnbilledRow[]; hidden: number } {
  const rows: UnbilledRow[] = [];
  let hidden = 0;
  for (const group of [...groups].sort((a, b) => a.oldest.getTime() - b.oldest.getTime() || a.id.localeCompare(b.id))) {
    const readable = group.kind === "task" ? access.readWorkOrders : access.readProjects;
    const name = (group.kind === "task" ? names.tasks : names.projects).get(group.id);
    if (!readable || !name) { hidden += 1; continue; }
    rows.push({
      kind: group.kind, id: group.id, title: name.title, customer: name.customer, seconds: group.seconds, entries: group.entries, invoicedSeconds: Math.max(0, group.invoicedSeconds ?? 0),
      materialRows: group.materialRows ?? 0,
      oldestDays: Math.max(0, Math.floor((now.getTime() - group.oldest.getTime()) / 86_400_000)),
      estimate: access.prices ? groupEstimate(group, rate) : null,
      href: group.kind === "task" ? `/?view=workflow_task&taskId=${encodeURIComponent(group.id)}&taskType=WORK_ORDER` : `/?view=project&projectId=${encodeURIComponent(group.id)}`,
      canCreate: access.createBases,
    });
  }
  return { rows, hidden };
}

/**
 * A group's estimate: hours × the hourly rate plus its unbilled material rows' own amounts. Null when it has time but no rate
 * (a sum without the time would look complete and be too low); a group of material only needs no rate.
 */
export function groupEstimate(group: Pick<UnbilledGroup, "seconds" | "materialNet">, rate: number | null): number | null {
  const time = group.seconds > 0 ? estimateValue(group.seconds, rate) : 0;
  return time === null ? null : time + Math.round(group.materialNet ?? 0);
}

// ---------- ofakturerat material ----------

/** A completed work order with material or expense rows, as read from its data (materialsFromData). */
export type MaterialJob = { taskId: string; projectId: string | null; completedAt: Date; materials: readonly MaterialRow[] };
export type MaterialGroup = { kind: "task" | "project"; id: string; rows: number; net: number | null; oldest: Date };

/** Every row key a basis would take from these jobs (the proposal's own rule: only rows with a name or an amount). */
export const materialSourceKeys = (jobs: readonly MaterialJob[]) => invoiceSourceKeys(jobs.map((job) => ({ id: job.taskId, title: "", entries: [], materials: job.materials })));

/**
 * Ofakturerat material (2026-10-29): per work order outside projects, or per project, the billable material and
 * expense rows no basis has taken – counted and priced exactly as the proposal would build them (linesFromWork, the rows'
 * own à-pris and påslag; a row without a price counts 0 kr). The oldest is the work order's completion.
 */
export function unbilledMaterialGroups(jobs: readonly MaterialJob[], taken: ReadonlySet<string>, prices: boolean): MaterialGroup[] {
  const groups = new Map<string, MaterialGroup>();
  for (const job of jobs) {
    const built = linesFromWork([{ id: job.taskId, title: "", entries: [], materials: job.materials }], { taken, hourlyRate: "", perJob: false });
    if (!built.lines.length) continue;
    const owner = job.projectId ? { kind: "project" as const, id: job.projectId } : { kind: "task" as const, id: job.taskId };
    const key = `${owner.kind}:${owner.id}`;
    const group = groups.get(key) ?? { ...owner, rows: 0, net: prices ? 0 : null, oldest: job.completedAt };
    group.rows += built.lines.length;
    if (group.net !== null) group.net = Math.round((group.net + invoiceBasisTotals(built.lines).net) * 100) / 100;
    if (job.completedAt < group.oldest) group.oldest = job.completedAt;
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Time groups and material groups as one list, oldest first: a job or project with both is one row (its oldest of the two).
 * A group with material only has no time.
 */
export function mergeUnbilled(time: readonly UnbilledGroup[], material: readonly MaterialGroup[]): UnbilledGroup[] {
  const merged = new Map<string, UnbilledGroup>(time.map((group) => [`${group.kind}:${group.id}`, { ...group, materialRows: group.materialRows ?? 0, materialNet: group.materialNet ?? null }]));
  for (const item of material) {
    const key = `${item.kind}:${item.id}`;
    const found = merged.get(key);
    if (found) merged.set(key, { ...found, materialRows: (found.materialRows ?? 0) + item.rows, materialNet: item.net === null ? null : (found.materialNet ?? 0) + item.net, oldest: item.oldest < found.oldest ? item.oldest : found.oldest });
    else merged.set(key, { kind: item.kind, id: item.id, seconds: 0, entries: 0, invoicedSeconds: 0, oldest: item.oldest, materialRows: item.rows, materialNet: item.net });
  }
  return [...merged.values()].sort((a, b) => a.oldest.getTime() - b.oldest.getTime() || a.id.localeCompare(b.id));
}

/** The company's estimate: all unbilled hours × the rate plus the unbilled material read (null when there is time but no rate). */
export function companyEstimate(totalSeconds: number, groups: readonly Pick<UnbilledGroup, "materialNet">[], rate: number | null): number | null {
  return groupEstimate({ seconds: totalSeconds, materialNet: groups.reduce((sum, group) => sum + (group.materialNet ?? 0), 0) }, rate);
}

// ---------- fakturerat per månad ----------

const MONTH_SHORT = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const MONTH_LONG = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
/** "2026-10" → "okt" / "oktober". */
export const monthShort = (key: string) => MONTH_SHORT[Number(key.slice(5, 7)) - 1] ?? key;
export const monthLong = (key: string) => MONTH_LONG[Number(key.slice(5, 7)) - 1] ?? key;

/** The last `count` months as "YYYY-MM", oldest first, ending with the month of `today` ("YYYY-MM-DD", Swedish). */
export function monthKeys(today: string, count: number): string[] {
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  return Array.from({ length: count }, (_, index) => {
    const offset = month - 1 - (count - 1 - index);
    const y = year + Math.floor(offset / 12), m = ((offset % 12) + 12) % 12 + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
  });
}

export type MonthFigure = { key: string; label: string; count: number; net: number | null };
/** Invoiced bases per month (their invoiced day in Sweden, "YYYY-MM-DD"); kronor only with the price right. */
export function invoicedPerMonth(bases: readonly { day: string; net: number }[], keys: readonly string[], prices: boolean): MonthFigure[] {
  return keys.map((key) => {
    const mine = bases.filter((basis) => basis.day.startsWith(`${key}-`));
    return { key, label: monthShort(key), count: mine.length, net: prices ? Math.round(mine.reduce((sum, basis) => sum + basis.net, 0)) : null };
  });
}

/** Share of a goal in whole percent, or null without a goal (or without the amount). */
export function goalShare(value: number | null, goal: number | null): number | null {
  return value === null || goal === null || goal <= 0 ? null : Math.round((value / goal) * 100);
}

// ---------- offerter ----------

export type QuoteVersionRow = { number: number; status: QuoteStatus; validUntil: string; superseded: boolean; changeOfVersion: number | null };
export type WinRate = { won: number; lost: number; percent: number | null };

/**
 * Andel vunna offerter: per quote number (its versions together; an ÄTA is a change of a won quote and is not counted
 * again), won when a version was accepted, lost when the latest version was declined or has expired, and not counted
 * while it still waits for an answer or is a draft.
 */
export function quoteWinRate(versions: readonly QuoteVersionRow[], today: string): WinRate {
  const byNumber = new Map<number, QuoteVersionRow[]>();
  for (const version of versions) {
    if (version.changeOfVersion !== null) continue;
    byNumber.set(version.number, [...(byNumber.get(version.number) ?? []), version]);
  }
  let won = 0, lost = 0;
  for (const rows of byNumber.values()) {
    if (rows.some((row) => row.status === "ACCEPTED")) { won += 1; continue; }
    const latest = rows.find((row) => !row.superseded);
    const status = latest ? effectiveQuoteStatus(latest, today) : null;
    if (status === "DECLINED" || status === "EXPIRED") lost += 1;
  }
  return { won, lost, percent: won + lost ? Math.round((won / (won + lost)) * 100) : null };
}

/** Whole days from `today` to a quote's valid-until day (both "YYYY-MM-DD"). */
export function daysUntil(today: string, day: string): number {
  return Math.round((Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86_400_000);
}

/** "går ut i dag", "går ut i morgon", "går ut om 5 dagar". */
export function expiresText(days: number): string {
  return days <= 0 ? "Går ut i dag" : days === 1 ? "Går ut i morgon" : `Går ut om ${days} dagar`;
}

/** Quotes that run out within this many days are listed (2026-10-28). */
export const QUOTE_EXPIRY_WINDOW_DAYS = 14;

// ---------- what the tab reads ----------

export type MoneyCount = { count: number; net: number | null; partial?: boolean };
export type ExpiringQuote = { id: string; label: string; title: string; customer: string; validUntil: string; days: number; net: number | null };
/** A won quote without a work order (the same row as Teamet's Kräver åtgärd). */
export type WonQuote = { id: string; label: string; title: string; customerName: string; decidedOn: string | null; net: number | null; href: string };

export type EconomyTabData = {
  /** Fakturaunderlag and quotes are Cloud only; a Local company sees the credits and a short line. */
  cloud: boolean;
  today: string;
  /** "oktober". */
  monthName: string;
  access: Pick<EconomyAccess, "prices" | "readBases" | "createBases" | "readQuotes">;
  goals: { invoicedPerMonth: number | null; quoteWinRatePercent: number | null };
  /** Verkligt: invoiced bases per month (the last six), this month last. */
  invoiced: { months: MonthFigure[]; partial: boolean } | null;
  /** Saved drafts, not invoiced yet (their own amounts – verkliga rader, men inte fakturerade). */
  drafts: MoneyCount | null;
  /** Uppskattning: finished time no basis has taken. */
  unbilled: {
    hourlyRate: boolean; totalSeconds: number; totalEstimate: number | null; groups: number;
    /** Unbilled material and expense rows over every group (2026-10-29). Optional so an older answer still draws. */
    totalMaterialRows?: number;
    /** More than the bounded reads: the counts are at least these. */
    partial?: boolean;
    rows: UnbilledRow[]; hidden: number; more: number;
  } | null;
  quotes: {
    awaiting: MoneyCount;
    expiring: { count: number; rows: ExpiringQuote[] };
    acceptedThisMonth: MoneyCount;
    winRate: WinRate & { months: number };
    /**
     * Accepterade offerter utan arbetsorder (Teamet's rule, lib/overview/team-model.ts awaitsWorkOrder): won work not started.
     * The rows only with Offerter – läsa (the count for everyone in Ekonomi). Optional so an older answer still draws.
     */
    withoutWorkOrder?: { count: number; rows: WonQuote[] };
  } | null;
  /** AI-krediter: the usable balance and its validity (lib/credits/wallet-summary.ts). */
  credits: CreditSummary | null;
};
