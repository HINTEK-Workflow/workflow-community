import type { MetricKey } from "./metrics";
import type { BoardCard, BoardLayout, CardSettings, CardType } from "./model";
import { ROWS_BY_ORIENTATION } from "./grid";
import type { Period } from "./period";
import type { SourceConfig } from "./cards";

/**
 * Färdiga exempeltavlor (2026-11-19): twelve boards to start from under Ny tavla, each built only on Workflow's own measures and
 * plain texts the company changes itself. No limit values (the company sets its own), no third party's text or picture. A template
 * is only a starting draft: the new board is the company's own and nothing follows the template afterwards. Pure.
 */
export const BOARD_TEMPLATE_KEYS = ["week_work", "month_economy", "rounds_deviations", "maintenance", "planning_capacity", "time_attendance", "customers_quotes", "self_inspection", "workshop_screen", "management_meeting", "production_hall", "daily_planning"] as const;
export type BoardTemplateKey = (typeof BOARD_TEMPLATE_KEYS)[number];
export type BoardTemplate = { key: BoardTemplateKey; label: string; description: string; layout: BoardLayout };

type Spec = { type: CardType; x: number; y: number; w: number; h: number; title?: string; metric?: MetricKey; period?: Period; settings?: CardSettings; source?: SourceConfig };
const layoutOf = (cards: Spec[]): BoardLayout => ({
  version: 1, orientation: "landscape", rows: ROWS_BY_ORIENTATION.landscape,
  cards: cards.map((spec, index): BoardCard => ({
    id: `k-${index + 1}`, type: spec.type, x: spec.x, y: spec.y, w: spec.w, h: spec.h, title: spec.title ?? "",
    data: spec.source ? { kind: "source", source: spec.source } : spec.metric ? { kind: "metric", metric: spec.metric, ...(spec.period ? { period: spec.period } : {}) } : null,
    settings: spec.settings ?? (spec.type === "clock" ? { showDate: true, showWeek: true } : {}),
  })),
});
const kpi = (x: number, y: number, w: number, h: number, metric: MetricKey, title = "", period?: Period, settings?: CardSettings): Spec => ({ type: "kpi", x, y, w, h, metric, title, period, settings });
const text = (x: number, y: number, w: number, h: number, heading: string, body: string): Spec => ({ type: "text", x, y, w, h, settings: { heading, body } });

const TEMPLATES: readonly BoardTemplate[] = [
  { key: "week_work", label: "Veckans arbete", description: "Klara och öppna jobb, förseningar, tid och dagens planering.", layout: layoutOf([
    kpi(0, 0, 6, 4, "tasks_completed_week", "Klara jobb i veckan", "week"),
    kpi(6, 0, 6, 4, "work_orders_open"),
    kpi(12, 0, 6, 4, "tasks_overdue"),
    kpi(18, 0, 6, 4, "hours_week", "Tid i veckan", "week"),
    { type: "chart", x: 0, y: 4, w: 12, h: 10, metric: "work_orders_by_status", period: "week", title: "Arbetsordrar", settings: { chart: "bar" } },
    { type: "table", x: 12, y: 4, w: 12, h: 10, metric: "planning_today" },
  ]) },
  { key: "month_economy", label: "Ekonomi i månaden", description: "Fakturerat, offerter, förfallna fakturor och tid i månaden.", layout: layoutOf([
    kpi(0, 0, 6, 5, "invoiced_amount", "Fakturerat i månaden", "month"),
    kpi(6, 0, 6, 5, "quotes_accepted", "Godkända offerter i månaden", "month"),
    kpi(12, 0, 6, 5, "quotes_sent"),
    kpi(18, 0, 6, 5, "invoices_overdue"),
    { type: "chart", x: 0, y: 5, w: 14, h: 9, metric: "hours_by_week", settings: { chart: "bar" } },
    kpi(14, 5, 10, 4, "hours_week", "Tid i månaden", "month"),
    kpi(14, 9, 10, 5, "customers_new", "Nya kunder i månaden", "month"),
  ]) },
  { key: "rounds_deviations", label: "Driftronder och avvikelser", description: "Ronder som inte blev gjorda, öppna och nya avvikelser och de senaste händelserna.", layout: layoutOf([
    kpi(0, 0, 6, 4, "rounds_missed", "Ronder som inte gjordes i veckan", "week"),
    kpi(6, 0, 6, 4, "deviations_open"),
    kpi(12, 0, 6, 4, "deviations_new", "Nya avvikelser i veckan", "week"),
    { type: "clock", x: 18, y: 0, w: 6, h: 4 },
    { type: "chart", x: 0, y: 4, w: 12, h: 10, metric: "deviations_by_type", period: "30d", settings: { chart: "bar" } },
    { type: "events", x: 12, y: 4, w: 12, h: 10, metric: "deviations_latest" },
  ]) },
  { key: "maintenance", label: "Underhåll", description: "Maskinernas läge, öppna felanmälningar och reservdelar som behöver beställas.", layout: layoutOf([
    { type: "status", x: 0, y: 0, w: 14, h: 8, metric: "machine_status" },
    kpi(14, 0, 10, 4, "faults_open"),
    kpi(14, 4, 10, 4, "work_orders_open"),
    { type: "table", x: 0, y: 8, w: 14, h: 6, metric: "store_below_min" },
    { type: "events", x: 14, y: 8, w: 10, h: 6, metric: "deviations_latest" },
  ]) },
  { key: "planning_capacity", label: "Planering och kapacitet", description: "Dagens bokningar, vilka som är borta och hur arbetsordrarna ligger till.", layout: layoutOf([
    { type: "table", x: 0, y: 0, w: 14, h: 14, metric: "planning_today" },
    kpi(14, 0, 5, 4, "absence_today_count"),
    kpi(19, 0, 5, 4, "tasks_overdue"),
    { type: "table", x: 14, y: 4, w: 10, h: 5, metric: "absence_today" },
    { type: "chart", x: 14, y: 9, w: 10, h: 5, metric: "work_orders_by_status", period: "week", title: "Arbetsordrar", settings: { chart: "bar" } },
  ]) },
  { key: "time_attendance", label: "Tid och närvaro", description: "Rapporterad tid mot förväntad tid, veckorna bakåt och frånvaro i dag.", layout: layoutOf([
    kpi(0, 0, 8, 5, "hours_week", "Rapporterad tid i veckan", "week"),
    { type: "gauge", x: 8, y: 0, w: 8, h: 5, metric: "hours_week", period: "week", title: "Andel av förväntad tid" },
    kpi(16, 0, 8, 5, "absence_today_count"),
    { type: "chart", x: 0, y: 5, w: 14, h: 9, metric: "hours_by_week", settings: { chart: "line" } },
    { type: "table", x: 14, y: 5, w: 10, h: 9, metric: "absence_today" },
  ]) },
  { key: "customers_quotes", label: "Kunder och offerter", description: "Offerter som väntar på svar, godkända offerter, nya kunder och pågående projekt.", layout: layoutOf([
    kpi(0, 0, 6, 5, "quotes_sent"),
    kpi(6, 0, 6, 5, "quotes_accepted", "Godkända offerter i månaden", "month"),
    kpi(12, 0, 6, 5, "customers_new", "Nya kunder i månaden", "month"),
    kpi(18, 0, 6, 5, "projects_active"),
    kpi(0, 5, 8, 4, "quotes_accepted", "Godkända offerter i år", "year"),
    kpi(8, 5, 8, 4, "customers_new", "Nya kunder i år", "year"),
    kpi(16, 5, 8, 4, "invoiced_amount", "Fakturerat i år", "year"),
    text(0, 9, 24, 5, "Att följa upp", "Skriv vilka kunder och offerter ni ska höra av er till den här veckan."),
  ]) },
  { key: "self_inspection", label: "Egenkontroll", description: "Öppna och nya avvikelser, förfallna jobb och de senaste avvikelserna.", layout: layoutOf([
    kpi(0, 0, 6, 4, "deviations_open"),
    kpi(6, 0, 6, 4, "deviations_new", "Nya avvikelser i månaden", "month"),
    kpi(12, 0, 6, 4, "tasks_overdue"),
    kpi(18, 0, 6, 4, "rounds_missed", "Ronder som inte gjordes i månaden", "month"),
    { type: "chart", x: 0, y: 4, w: 12, h: 10, metric: "deviations_by_type", period: "year", title: "Avvikelser per typ i år", settings: { chart: "bar" } },
    { type: "events", x: 12, y: 4, w: 12, h: 10, metric: "deviations_latest" },
  ]) },
  { key: "workshop_screen", label: "Skärm i verkstaden", description: "Klocka, dagens jobb och ett meddelande, läsbart på håll.", layout: layoutOf([
    { type: "clock", x: 0, y: 0, w: 8, h: 5 },
    { type: "table", x: 8, y: 0, w: 16, h: 14, metric: "planning_today", title: "Dagens jobb", settings: { textSize: "large" } },
    kpi(0, 5, 8, 4, "work_orders_open"),
    text(0, 9, 8, 5, "Dagens meddelande", "Skriv ett meddelande till alla i verkstaden."),
  ]) },
  { key: "management_meeting", label: "Ledningsgruppens möte", description: "Månadens viktigaste tal, tid per vecka och arbetsordrarnas läge.", layout: layoutOf([
    kpi(0, 0, 6, 4, "tasks_completed_week", "Klara jobb i månaden", "month"),
    kpi(6, 0, 6, 4, "invoiced_amount", "Fakturerat i månaden", "month"),
    kpi(12, 0, 6, 4, "deviations_new", "Nya avvikelser i månaden", "month"),
    kpi(18, 0, 6, 4, "projects_active"),
    { type: "chart", x: 0, y: 4, w: 12, h: 10, metric: "hours_by_week", settings: { chart: "area" } },
    { type: "chart", x: 12, y: 4, w: 12, h: 5, metric: "work_orders_by_status", period: "month", title: "Arbetsordrar i månaden", settings: { chart: "bar" } },
    text(12, 9, 12, 5, "Beslut och frågor", "Skriv vad mötet ska ta upp och vad som beslutades."),
  ]) },
  // The newer cards (2026-11-19): the machine connection, Underhåll, Felanmälan, the calendar and trends.
  { key: "production_hall", label: "Produktionshallen", description: "Maskinernas läge, de senaste larmen, underhållsjobb, felanmälningar och stopp per dag.", layout: layoutOf([
    { type: "machines", x: 0, y: 0, w: 12, h: 6, source: { type: "machines" } },
    { type: "machine_events", x: 12, y: 0, w: 12, h: 6, title: "Senaste larmen", source: { type: "machine_events", alarmsOnly: true } },
    { type: "upkeep", x: 0, y: 6, w: 8, h: 8, source: { type: "upkeep", horizon: "30d" } },
    { type: "faults", x: 8, y: 6, w: 8, h: 8, source: { type: "faults", period: "week" } },
    { type: "machine_signal", x: 16, y: 6, w: 8, h: 8, title: "Stopp per dag", source: { type: "machine_signal", measure: "stops", period: "week" }, settings: { chart: "bar" } },
  ]) },
  { key: "daily_planning", label: "Dagens planering", description: "Dagens bokningar per person, klara och förfallna jobb, veckans bokningar och trenden för klara jobb.", layout: layoutOf([
    { type: "clock", x: 0, y: 0, w: 6, h: 4 },
    kpi(0, 4, 6, 5, "tasks_completed_week", "Klara jobb i dag", "today"),
    kpi(0, 9, 6, 5, "tasks_overdue"),
    { type: "calendar", x: 6, y: 0, w: 12, h: 14, title: "Dagens bokningar", source: { type: "calendar", range: "today", view: "schedule" } },
    { type: "trend", x: 18, y: 0, w: 6, h: 7, title: "Klara jobb per vecka", source: { type: "trend", metrics: ["tasks_completed_week"], period: "week" } },
    { type: "calendar", x: 18, y: 7, w: 6, h: 7, title: "Veckans bokningar", source: { type: "calendar", range: "week", view: "list" } },
  ]) },
];

const BY_KEY = Object.fromEntries(TEMPLATES.map((template) => [template.key, template])) as Record<BoardTemplateKey, BoardTemplate>;
export const BOARD_TEMPLATES = TEMPLATES;
/** A fresh copy of the template's board (the caller may change it freely). */
export function boardTemplate(key: BoardTemplateKey): BoardTemplate {
  const template = BY_KEY[key];
  return { ...template, layout: JSON.parse(JSON.stringify(template.layout)) as BoardLayout };
}
