import { goalShare, hoursText, type EconomyTabData } from "./economy-model";
import { word } from "./team-headline";

/**
 * Läget i ekonomin överst på Ekonomi (2026-10-29, the same idea as Jag's greeting and Teamet's situation): the figures
 * and one sentence from the tab's own answer – work with finished time or material no basis has taken, drafts not invoiced,
 * won quotes without a work order, quotes running out and this month against the company's goal. Pure, so the page, the demo
 * and the tests read the same words; nothing is guessed (amounts only when the answer has them, i.e. with the price right).
 */

/** Unbilled work older than this many days is late (red), from this many it is a warning (amber). */
export const UNBILLED_LATE_DAYS = 30;
export const UNBILLED_WARN_DAYS = 14;

/** A row's tone by the age of its oldest unbilled work. */
export function unbilledTone(oldestDays: number): "danger" | "warning" | "neutral" {
  return oldestDays >= UNBILLED_LATE_DAYS ? "danger" : oldestDays >= UNBILLED_WARN_DAYS ? "warning" : "neutral";
}

/**
 * "Fakturerat av upparbetat" for a job or project: the share of its finished time a basis has already taken, in whole
 * percent – never 100 while time is still left to bill, so the line never looks done when it is not.
 */
export function invoicedTimeShare(unbilledSeconds: number, invoicedSeconds: number): number {
  const open = Math.max(0, unbilledSeconds), done = Math.max(0, invoicedSeconds);
  if (!done) return 0;
  const share = Math.round((done / (open + done)) * 100);
  return open > 0 ? Math.min(99, share) : share;
}

/** The status word of an unbilled row: nothing billed yet, or billed in part. */
export const invoicedStatus = (invoicedSeconds: number) => invoicedSeconds > 0 ? "Delvis fakturerat" : "Ej fakturerat";

/** "1 materialrad", "3 materialrader" (material and expense rows alike, 2026-10-29). */
export const materialRowsText = (count: number) => `${count} ${count === 1 ? "materialrad" : "materialrader"}`;

export type EconomyFigures = {
  /** Jobs and projects with finished time or material no basis has taken (the company's, also those the viewer cannot open). */
  unbilled: number; unbilledSeconds: number; unbilledEstimate: number | null;
  /** Material and expense rows no basis has taken. */
  materialRows: number;
  /** Of the rows the viewer sees, those waiting UNBILLED_LATE_DAYS or more. */
  late: number;
  drafts: number; expiring: number; withoutWorkOrder: number;
  /** This month's invoiced amount against the goal in percent; null without the price right or a goal. */
  goalShare: number | null;
};

export function economyFigures(data: EconomyTabData): EconomyFigures {
  const unbilled = data.unbilled;
  const month = data.invoiced?.months.at(-1);
  return {
    unbilled: unbilled?.groups ?? 0,
    unbilledSeconds: unbilled?.totalSeconds ?? 0,
    // The server sends no estimate without the price right, or with time but no hourly rate.
    unbilledEstimate: data.access.prices ? unbilled?.totalEstimate ?? null : null,
    materialRows: unbilled?.totalMaterialRows ?? 0,
    late: (unbilled?.rows ?? []).filter((row) => row.oldestDays >= UNBILLED_LATE_DAYS).length,
    drafts: data.drafts?.count ?? 0,
    expiring: data.quotes?.expiring.count ?? 0,
    withoutWorkOrder: data.quotes?.withoutWorkOrder?.count ?? 0,
    goalShare: data.access.prices ? goalShare(month?.net ?? null, data.goals.invoicedPerMonth) : null,
  };
}

/** What needs doing on the tab: the unbilled jobs, the drafts, the won quotes to start and the quotes running out. */
export const economyActionCount = (figures: EconomyFigures) => figures.unbilled + figures.drafts + figures.withoutWorkOrder + figures.expiring;

// A no-break space before "kr", so an amount never wraps from its unit.
const kronor = (value: number) => `${Math.round(value).toLocaleString("sv-SE")} kr`;

/** "Fem jobb har färdig tid eller material utan fakturaunderlag, 12,5 h och 3 materialrader (≈ 8 125 kr). …" */
export function economySentence(data: EconomyTabData): string {
  const figures = economyFigures(data);
  const parts: string[] = [];
  if (figures.unbilled) {
    const amount = figures.unbilledEstimate !== null ? ` (≈ ${kronor(figures.unbilledEstimate)})` : "";
    // "jobb" is neuter: Ett jobb, Ett av dem.
    const neuter = (count: number) => count === 1 ? "Ett" : word(count);
    const time = figures.unbilledSeconds > 0, material = figures.materialRows > 0;
    const what = time && material ? "färdig tid eller material" : material ? "material" : "färdig tid";
    const how = [time ? hoursText(figures.unbilledSeconds) : "", material ? materialRowsText(figures.materialRows) : ""].filter(Boolean).join(" och ");
    parts.push(`${neuter(figures.unbilled)} jobb har ${what} utan fakturaunderlag, ${how}${amount}.`);
    if (figures.late) parts.push(`${neuter(figures.late)} av dem har väntat över ${UNBILLED_LATE_DAYS} dagar – börja där.`);
  }
  if (figures.drafts) parts.push(figures.drafts === 1 ? "Ett utkast är inte fakturerat." : `${word(figures.drafts)} utkast är inte fakturerade.`);
  if (figures.withoutWorkOrder) parts.push(figures.withoutWorkOrder === 1 ? "En vunnen offert saknar arbetsorder." : `${word(figures.withoutWorkOrder)} vunna offerter saknar arbetsorder.`);
  if (figures.expiring) parts.push(figures.expiring === 1 ? "En offert går ut inom 14 dagar." : `${word(figures.expiring)} offerter går ut inom 14 dagar.`);
  if (!economyActionCount(figures)) parts.push("Allt färdigt arbete finns i ett fakturaunderlag och inga offerter behöver följas upp.");
  if (figures.goalShare !== null) parts.push(`${figures.goalShare} % av månadens mål är fakturerat.`);
  return parts.join(" ");
}
