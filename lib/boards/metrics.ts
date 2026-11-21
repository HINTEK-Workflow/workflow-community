import { canViewTeam, hasWorkflowPermission, type WorkflowPermissionProfile, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { organizationModuleOn, type ModuleKey } from "@/lib/workflow/modules";
import type { ShapeKind } from "./shapes";
import type { Period } from "./period";

/**
 * Workflow-mått (Tavlor etapp 1, 2026-11-18): the ready figures a card can show, built on the same rules as the pages they come from.
 * Each measure needs the same right as its page (a measure of Teamet needs Teamet, one of Underhåll needs Underhåll …) and stops with
 * its module. The catalogue is pure, so the editor lists only what the person may use and the server refuses the rest with the same
 * rule (lib/boards/metrics-server.ts counts them). Names that are personal data are marked: outside the app they are hidden unless
 * the publisher chose initials or names for that card (lib/boards/privacy.ts), and a reason for absence is never shown at all.
 */
export const METRIC_KEYS = [
  "work_orders_open", "work_orders_by_status", "tasks_overdue", "tasks_completed_week", "projects_active",
  "deviations_open", "deviations_new", "deviations_by_type", "deviations_latest", "rounds_missed",
  "hours_week", "hours_by_week", "absence_today_count", "absence_today",
  "planning_today", "quotes_sent", "quotes_accepted", "invoiced_amount", "invoices_overdue", "customers_new",
  "machine_status", "faults_open", "store_below_min",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export const isMetricKey = (value: unknown): value is MetricKey => (METRIC_KEYS as readonly unknown[]).includes(value);

/** Who reads a measure: the signed-in person in the app, or the person who published the board for a screen or a link. */
export type MetricViewer = {
  userId: string;
  admin: boolean;
  workflowPermissions: WorkflowPermissionProfile;
  organization: { disabledModules?: readonly string[] | null };
};

export type MetricGroup = "Arbete" | "Avvikelser och ronder" | "Tid och frånvaro" | "Planering" | "Kunder och ekonomi" | "Underhåll";
export type MetricDefinition = {
  key: MetricKey;
  label: string;
  /** One line in the editor's list. */
  description: string;
  group: MetricGroup;
  shape: ShapeKind;
  unit?: string;
  module: ModuleKey | null;
  /** The periods the card may choose (2026-11-19), the first one unless `period` says otherwise; none: the measure is "now". */
  periods?: readonly Period[];
  period?: Period;
  /** A figure that can be compared with the period before. */
  compares?: boolean;
  /** The table columns that hold people's names (personal data). */
  personal?: readonly string[];
  /** The same right as the measure's page. */
  allowed: (viewer: MetricViewer) => boolean;
};

const reads = (viewer: MetricViewer, subject: WorkflowPermissionSubject) => viewer.admin || hasWorkflowPermission(viewer.workflowPermissions, subject, "read");
const readsJobs = (viewer: MetricViewer) => (["work-order", "kfid", "risk-assessment", "forms"] as const).some((subject) => reads(viewer, subject));
const team = (viewer: MetricViewer) => canViewTeam({ admin: viewer.admin, workflowPermissions: viewer.workflowPermissions });

const CALENDAR: readonly Period[] = ["week", "today", "month", "year"];
const SPANS: readonly Period[] = ["30d", "week", "month", "year"];

export const METRICS: readonly MetricDefinition[] = [
  { key: "work_orders_open", label: "Öppna arbetsordrar", description: "Arbetsordrar som inte är klara eller avbrutna.", group: "Arbete", shape: "number", module: null, allowed: (v) => reads(v, "work-order") },
  { key: "work_orders_by_status", label: "Arbetsordrar per status", description: "Planerade och pågående nu, och de som blev klara under perioden.", group: "Arbete", shape: "series", module: null, periods: SPANS, allowed: (v) => reads(v, "work-order") },
  { key: "tasks_overdue", label: "Förfallna jobb", description: "Jobb vars Klart senast har passerat.", group: "Arbete", shape: "number", module: null, allowed: readsJobs },
  { key: "tasks_completed_week", label: "Klara jobb", description: "Jobb som blev klara under perioden.", group: "Arbete", shape: "number", module: null, periods: CALENDAR, compares: true, allowed: readsJobs },
  { key: "projects_active", label: "Pågående projekt", description: "Projekt som inte är avslutade eller arkiverade.", group: "Arbete", shape: "number", module: "projects", allowed: (v) => reads(v, "projects") },
  { key: "deviations_open", label: "Öppna avvikelser", description: "Avvikelser som inte är klara.", group: "Avvikelser och ronder", shape: "number", module: null, allowed: () => true },
  { key: "deviations_new", label: "Nya avvikelser", description: "Avvikelser som skrevs under perioden.", group: "Avvikelser och ronder", shape: "number", module: null, periods: CALENDAR, compares: true, allowed: () => true },
  { key: "deviations_by_type", label: "Avvikelser per typ", description: "Nya avvikelser under perioden, per typ.", group: "Avvikelser och ronder", shape: "series", module: null, periods: SPANS, allowed: () => true },
  { key: "deviations_latest", label: "Senaste avvikelser", description: "De senaste avvikelserna, utan namn.", group: "Avvikelser och ronder", shape: "events", module: null, allowed: () => true },
  { key: "rounds_missed", label: "Ronder som inte gjordes", description: "Ronder som markerades som inte gjorda under perioden.", group: "Avvikelser och ronder", shape: "number", module: "rounds", periods: CALENDAR, compares: true, allowed: readsJobs },
  { key: "hours_week", label: "Rapporterad tid", description: "Teamets timmar under perioden. Veckan jämförs med förväntad tid.", group: "Tid och frånvaro", shape: "number", unit: "h", module: "time", periods: CALENDAR, compares: true, allowed: team },
  { key: "hours_by_week", label: "Rapporterad tid per vecka", description: "Teamets timmar de senaste åtta veckorna.", group: "Tid och frånvaro", shape: "series", unit: "h", module: "time", allowed: team },
  { key: "absence_today_count", label: "Frånvarande i dag", description: "Antal personer med godkänd frånvaro i dag. Aldrig orsaken.", group: "Tid och frånvaro", shape: "number", module: "time", allowed: team },
  { key: "absence_today", label: "Frånvaro i dag", description: "Vilka som är borta i dag. Namnen är dolda utanför appen om du inte väljer annat. Aldrig orsaken.", group: "Tid och frånvaro", shape: "table", module: "time", personal: ["person"], allowed: team },
  { key: "planning_today", label: "Dagens planering", description: "Bokningar i dag med tid, jobb och vem.", group: "Planering", shape: "table", module: "planning", personal: ["people"], allowed: readsJobs },
  { key: "quotes_sent", label: "Offerter ute", description: "Skickade offerter som väntar på svar.", group: "Kunder och ekonomi", shape: "number", module: "quotes", allowed: (v) => reads(v, "quotes") },
  { key: "quotes_accepted", label: "Godkända offerter", description: "Offerter som kunden godkände under perioden.", group: "Kunder och ekonomi", shape: "number", module: "quotes", periods: CALENDAR, period: "month", compares: true, allowed: (v) => reads(v, "quotes") },
  { key: "invoiced_amount", label: "Fakturerat", description: "Fakturor och krediteringar utan moms, efter fakturadatum.", group: "Kunder och ekonomi", shape: "number", unit: "kr", module: "invoicing", periods: CALENDAR, period: "month", compares: true, allowed: (v) => reads(v, "invoicing") },
  { key: "invoices_overdue", label: "Förfallna fakturor", description: "Obetalda fakturor vars förfallodag har passerat.", group: "Kunder och ekonomi", shape: "number", module: "invoicing", allowed: (v) => reads(v, "invoicing") },
  { key: "customers_new", label: "Nya kunder", description: "Kunder som lades till under perioden.", group: "Kunder och ekonomi", shape: "number", module: "customers", periods: CALENDAR, period: "month", compares: true, allowed: (v) => reads(v, "customers") },
  { key: "machine_status", label: "Maskinstatus", description: "Maskinernas läge och öppna felanmälningar.", group: "Underhåll", shape: "status", module: "upkeep", allowed: (v) => reads(v, "maintenance") },
  { key: "faults_open", label: "Öppna felanmälningar", description: "Underhållsposter som inte är åtgärdade.", group: "Underhåll", shape: "number", module: "upkeep", allowed: (v) => reads(v, "maintenance") },
  { key: "store_below_min", label: "Reservdelar under miniminivå", description: "Artiklar i förrådet med lägre saldo än miniminivån.", group: "Underhåll", shape: "table", module: "upkeep", allowed: (v) => reads(v, "maintenance") },
];

const BY_KEY = Object.fromEntries(METRICS.map((metric) => [metric.key, metric])) as Record<MetricKey, MetricDefinition>;
export const metricDefinition = (key: MetricKey) => BY_KEY[key];
/** The period a measure counts for a card: the card's choice when the measure offers it, else the measure's own (none: "now"). */
export function metricPeriod(key: MetricKey, wanted?: Period | null): Period | null {
  const metric = BY_KEY[key];
  if (!metric.periods?.length) return null;
  return wanted && metric.periods.includes(wanted) ? wanted : metric.period ?? metric.periods[0]!;
}

/** Whether the viewer may read the measure now: the module is on and the viewer has its right. */
export function metricAccess(key: MetricKey, viewer: MetricViewer): "ok" | "module_off" | "forbidden" {
  const metric = BY_KEY[key];
  if (metric.module && !organizationModuleOn(viewer.organization, metric.module)) return "module_off";
  return metric.allowed(viewer) ? "ok" : "forbidden";
}

/** A measure as the editor receives it (features/boards/boards-api.ts MetricOption): no rule, only what the panel shows. */
export const metricOption = ({ key, label, description, group, shape, unit, personal, periods, period, compares }: MetricDefinition) =>
  ({ key, label, description, group, shape, unit: unit ?? null, personal: Boolean(personal?.length), periods: [...(periods ?? [])], period: period ?? periods?.[0] ?? null, compares: Boolean(compares) });

/** The measures the editor offers the viewer, grouped in the catalogue's order. */
export function metricsFor(viewer: MetricViewer) {
  return METRICS.filter((metric) => metricAccess(metric.key, viewer) === "ok");
}
