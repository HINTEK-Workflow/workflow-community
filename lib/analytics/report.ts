import { DEMO_FLOW_KEYS, DEMO_SOURCE_KEYS, DEMO_START_KEYS, DEMO_TIME_KEYS, FUNNEL_LABELS, FUNNEL_STEPS, LANDING_CLICK_KEYS, LANDING_DEVICE_KEYS, demoKeyLabel, isFunnelStep, kindLabel, landingKeyLabel, type FunnelStep } from "./catalog";
import { csvCell } from "../csv/cell";

/**
 * What the Beteendeanalys page shows, worked out from the counters (2026-10-07): per day and per week, the pages
 * and functions most used, and the funnel of the public pages with its conversion. Pure, so the page, the CSV and the
 * tests use the same figures. The counters carry no person, company or browser, so neither does anything here.
 */
export type CounterRowLike = { day: string; kind: string; key: string; count: number };

export type DayPoint = { date: string; pages: number; features: number };
export type WeekPoint = { /** The Monday of the week. */ date: string; label: string; pages: number; features: number };
export type RankedRow = { key: string; label: string; count: number; /** Share of the list's total, 0–100. */ share: number };
export type FunnelRow = { step: FunnelStep; label: string; count: number; /** Of the step before, 0–100; null for the first step or when the step before is empty. */ ofPrevious: number | null; /** Of the first step, 0–100. */ ofFirst: number | null };
/** The public demo: a count is a visit (a page load), never a person. */
export type DemoReport = {
  hasData: boolean;
  starts: { total: number; rows: RankedRow[] };
  /** Where the starts came from (the Referer's group, 2026-11-11), in a fixed order. */
  sources: RankedRow[];
  /** Starts per day, oldest first. */
  daily: { date: string; starts: number }[];
  views: RankedRow[];
  flows: RankedRow[];
  /** Time in the demo in four buckets, in order; the shares are of the visits that were counted. */
  time: RankedRow[];
};
/** The public website (2026-11-16): page loads, counted buttons, where visitors came from and the screen; no cookie. */
export type LandingReport = {
  hasData: boolean;
  /** Page loads on the start page and the feature pages together. */
  views: number;
  pages: RankedRow[];
  /** The counted buttons, in a fixed order. */
  clicks: RankedRow[];
  /** The referring sites (domain only), the most first; "none" is a visit without one. */
  sources: RankedRow[];
  devices: RankedRow[];
  newsletter: { requested: number; confirmed: number };
};
/** The public pages per day or week (2026-11-11): the funnel's steps, the answers in the cookie box and the website's page loads. */
export type PublicPoint = { date: string; label?: string; landing: number; pricing: number; register: number; checkout: number; statistics: number; necessary: number; demoStarts: number; landingViews: number };
export type Report = {
  demo: DemoReport;
  landing: LandingReport;
  from: string; to: string;
  hasData: boolean;
  totals: { pageViews: number; featureUses: number };
  daily: DayPoint[];
  weekly: WeekPoint[];
  publicDaily: PublicPoint[];
  publicWeekly: PublicPoint[];
  pages: RankedRow[];
  features: RankedRow[];
  funnel: { steps: FunnelRow[]; /** Checkout of landing, 0–100; null without landing visits. */ conversion: number | null; hasData: boolean };
  consent: { statistics: number; necessary: number; /** Share who allowed statistics, 0–100; null without answers. */ rate: number | null };
};

const DAY = 86_400_000;
const time = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
export const addReportDays = (day: string, days: number) => iso(time(day) + days * DAY);
const monday = (day: string) => iso(time(day) - ((new Date(time(day)).getUTCDay() + 6) % 7) * DAY);
/** ISO week number of a day, for the label "v. 41". */
export function isoWeek(day: string) {
  const thursday = new Date(time(day));
  thursday.setUTCDate(thursday.getUTCDate() - ((thursday.getUTCDay() + 6) % 7) + 3);
  const january4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thursday.getTime() - january4.getTime()) / DAY - 3 + ((january4.getUTCDay() + 6) % 7)) / 7);
  return { year: thursday.getUTCFullYear(), week };
}

/** The longest period the page draws day by day. */
export const MAX_REPORT_DAYS = 400;
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

function ranked(counts: Map<string, number>, kind: string, limit: number): RankedRow[] {
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit)
    .map(([key, count]) => ({ key, label: kindLabel(kind, key), count, share: percent(count, total) ?? 0 }));
}

/** The report for a period (both days included; at most MAX_REPORT_DAYS long, the end days kept). */
export function buildReport(rows: CounterRowLike[], from: string, to: string): Report {
  const start = to > from && time(to) - time(from) > (MAX_REPORT_DAYS - 1) * DAY ? addReportDays(to, -(MAX_REPORT_DAYS - 1)) : from;
  const inRange = rows.filter((row) => row.day >= start && row.day <= to);
  const pages = new Map<string, number>();
  const features = new Map<string, number>();
  const funnelCounts = new Map<string, number>();
  const consentCounts = new Map<string, number>();
  const perDay = new Map<string, { pages: number; features: number }>();
  const demoCounts = new Map<string, number>();
  const demoDay = new Map<string, { starts: number }>();
  const publicDay = new Map<string, Omit<PublicPoint, "date" | "label">>();
  const emptyPublic = () => ({ landing: 0, pricing: 0, register: 0, checkout: 0, statistics: 0, necessary: 0, demoStarts: 0, landingViews: 0 });
  const landingCounts = new Map<string, number>();
  for (const row of inRange) {
    const point = publicDay.get(row.day) ?? emptyPublic();
    if (row.kind === "funnel" && isFunnelStep(row.key)) point[row.key] += row.count;
    else if (row.kind === "consent" && (row.key === "statistics" || row.key === "necessary")) point[row.key] += row.count;
    else if (row.kind === "demo" && (DEMO_START_KEYS as readonly string[]).includes(row.key)) point.demoStarts += row.count;
    else if (row.kind === "landing") {
      landingCounts.set(row.key, (landingCounts.get(row.key) ?? 0) + row.count);
      if (row.key.startsWith("page:")) point.landingViews += row.count;
    }
    publicDay.set(row.day, point);
  }
  for (const row of inRange) {
    const day = perDay.get(row.day) ?? { pages: 0, features: 0 };
    if (row.kind === "page") { pages.set(row.key, (pages.get(row.key) ?? 0) + row.count); day.pages += row.count; }
    else if (row.kind === "feature") { features.set(row.key, (features.get(row.key) ?? 0) + row.count); day.features += row.count; }
    else if (row.kind === "funnel") funnelCounts.set(row.key, (funnelCounts.get(row.key) ?? 0) + row.count);
    else if (row.kind === "demo") {
      demoCounts.set(row.key, (demoCounts.get(row.key) ?? 0) + row.count);
      const point = demoDay.get(row.day) ?? { starts: 0 };
      if ((DEMO_START_KEYS as readonly string[]).includes(row.key)) point.starts += row.count;
      demoDay.set(row.day, point);
    }
    else if (row.kind === "consent") consentCounts.set(row.key, (consentCounts.get(row.key) ?? 0) + row.count);
    perDay.set(row.day, day);
  }
  const daily: DayPoint[] = [];
  for (let day = start; day <= to; day = addReportDays(day, 1)) daily.push({ date: day, ...(perDay.get(day) ?? { pages: 0, features: 0 }) });
  const weeks = new Map<string, WeekPoint>();
  for (const point of daily) {
    const week = monday(point.date);
    const current = weeks.get(week) ?? { date: week, label: `v. ${isoWeek(week).week}`, pages: 0, features: 0 };
    current.pages += point.pages;
    current.features += point.features;
    weeks.set(week, current);
  }
  const publicDaily: PublicPoint[] = daily.map((point) => ({ date: point.date, ...(publicDay.get(point.date) ?? emptyPublic()) }));
  const publicWeeks = new Map<string, PublicPoint>();
  for (const point of publicDaily) {
    const week = monday(point.date);
    const current = publicWeeks.get(week) ?? { date: week, label: `v. ${isoWeek(week).week}`, ...emptyPublic() };
    for (const key of ["landing", "pricing", "register", "checkout", "statistics", "necessary", "demoStarts", "landingViews"] as const) current[key] += point[key];
    publicWeeks.set(week, current);
  }
  const first = funnelCounts.get(FUNNEL_STEPS[0]) ?? 0;
  const steps: FunnelRow[] = FUNNEL_STEPS.map((step, index) => {
    const count = funnelCounts.get(step) ?? 0;
    const before = index ? funnelCounts.get(FUNNEL_STEPS[index - 1]) ?? 0 : 0;
    // A visitor can arrive at a later step by a direct link, so a share is never shown above 100 %.
    const capped = (value: number | null) => (value === null ? null : Math.min(100, value));
    return { step, label: FUNNEL_LABELS[step], count, ofPrevious: index ? capped(percent(count, before)) : null, ofFirst: index ? capped(percent(count, first)) : null };
  });
  const statistics = consentCounts.get("statistics") ?? 0;
  const necessary = consentCounts.get("necessary") ?? 0;
  const lastStep = funnelCounts.get(FUNNEL_STEPS[FUNNEL_STEPS.length - 1]) ?? 0;
  const fixedRows = (keys: readonly string[]): RankedRow[] => {
    const total = keys.reduce((sum, key) => sum + (demoCounts.get(key) ?? 0), 0);
    return keys.map((key) => ({ key, label: demoKeyLabel(key), count: demoCounts.get(key) ?? 0, share: percent(demoCounts.get(key) ?? 0, total) ?? 0 }));
  };
  const viewCounts = new Map([...demoCounts].filter(([key]) => key.startsWith("view:")).map(([key, count]) => [key.slice(5), count] as const));
  const startRows = fixedRows(DEMO_START_KEYS);
  const demo: DemoReport = {
    hasData: demoCounts.size > 0,
    starts: { total: startRows.reduce((sum, row) => sum + row.count, 0), rows: startRows },
    sources: fixedRows(DEMO_SOURCE_KEYS),
    daily: daily.map((point) => ({ date: point.date, ...(demoDay.get(point.date) ?? { starts: 0 }) })),
    views: ranked(viewCounts, "page", 12),
    flows: fixedRows(DEMO_FLOW_KEYS),
    time: fixedRows(DEMO_TIME_KEYS),
  };
  const landingGroup = (group: string) => new Map([...landingCounts].filter(([key]) => key.startsWith(`${group}:`)));
  const landingRows = (counts: Map<string, number>, limit: number): RankedRow[] => {
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit)
      .map(([key, count]) => ({ key, label: landingKeyLabel(key), count, share: percent(count, total) ?? 0 }));
  };
  const landingFixed = (group: string, keys: readonly string[]): RankedRow[] => {
    const total = keys.reduce((sum, key) => sum + (landingCounts.get(`${group}:${key}`) ?? 0), 0);
    return keys.map((key) => { const count = landingCounts.get(`${group}:${key}`) ?? 0; return { key: `${group}:${key}`, label: landingKeyLabel(`${group}:${key}`), count, share: percent(count, total) ?? 0 }; });
  };
  const pageCounts = landingGroup("page");
  const landing: LandingReport = {
    hasData: landingCounts.size > 0,
    views: [...pageCounts.values()].reduce((sum, value) => sum + value, 0),
    pages: landingRows(pageCounts, 12),
    clicks: landingFixed("click", LANDING_CLICK_KEYS),
    sources: landingRows(landingGroup("ref"), 12),
    devices: landingFixed("device", LANDING_DEVICE_KEYS),
    newsletter: { requested: landingCounts.get("newsletter:requested") ?? 0, confirmed: landingCounts.get("newsletter:confirmed") ?? 0 },
  };
  return {
    demo, landing,
    from: start, to,
    hasData: inRange.length > 0,
    totals: { pageViews: [...pages.values()].reduce((sum, value) => sum + value, 0), featureUses: [...features.values()].reduce((sum, value) => sum + value, 0) },
    daily, weekly: [...weeks.values()], publicDaily, publicWeekly: [...publicWeeks.values()],
    pages: ranked(pages, "page", 12), features: ranked(features, "feature", 12),
    funnel: { steps, conversion: first ? Math.min(100, percent(lastStep, first) ?? 0) : null, hasData: steps.some((step) => step.count > 0) },
    consent: { statistics, necessary, rate: percent(statistics, statistics + necessary) },
  };
}

/** The headline figures of a period, for the key-figure tiles and the comparison with the period before (2026-11-11). */
export type PeriodTotals = {
  pageViews: number; featureUses: number; demoStarts: number; landingViews: number;
  landing: number; register: number; checkout: number;
  statistics: number; necessary: number;
  /** Share who allowed statistics, 0–100; null without answers. */ consentRate: number | null;
  /** Skapa konto of landing visits, 0–100 (capped); null without landing visits. */ registerRate: number | null;
};
export const periodTotals = (report: Report): PeriodTotals => {
  const step = (name: FunnelStep) => report.funnel.steps.find((row) => row.step === name)?.count ?? 0;
  const landing = step("landing");
  return {
    pageViews: report.totals.pageViews, featureUses: report.totals.featureUses, demoStarts: report.demo.starts.total, landingViews: report.landing.views,
    landing, register: step("register"), checkout: step("checkout"),
    statistics: report.consent.statistics, necessary: report.consent.necessary, consentRate: report.consent.rate,
    registerRate: landing ? Math.min(100, percent(step("register"), landing) ?? 0) : null,
  };
};

/** The period of the same length right before `from`–`to` (both days included). */
export function previousPeriod(from: string, to: string) {
  const days = Math.round((time(to) - time(from)) / DAY) + 1;
  return { from: addReportDays(from, -days), to: addReportDays(from, -1) };
}

/**
 * Change from the period before in percent (one decimal); null when the period before had nothing, so a start from zero
 * is never shown as "+∞ %".
 */
export const changePercent = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);

/** The report for a period with the headline figures of the period before it (`rows` may cover both). */
export function buildComparedReport(rows: CounterRowLike[], from: string, to: string): Report & { previous: PeriodTotals & { from: string; to: string } } {
  const report = buildReport(rows, from, to);
  const before = previousPeriod(report.from, report.to);
  return { ...report, previous: { ...before, ...periodTotals(buildReport(rows, before.from, before.to)) } };
}

const KIND_NAME: Record<string, string> = { page: "sida", feature: "funktion", funnel: "tratt", consent: "samtycke", demo: "demo", landing: "webbplats" };
// The same CSV cell as every export: keys and names never run as a formula in Excel (R2, review 2026-10-20).
const cell = csvCell;

/** The counters as CSV for Excel (semicolon, UTF-8 with a byte order mark): date, kind, key, name, count. */
export function countersCsv(rows: CounterRowLike[]) {
  const lines = [["datum", "typ", "nyckel", "namn", "antal"].map(cell).join(";")];
  for (const row of [...rows].sort((a, b) => a.day.localeCompare(b.day) || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)))
    lines.push([row.day, KIND_NAME[row.kind] ?? row.kind, row.key, kindLabel(row.kind, row.key), row.count].map(cell).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}
