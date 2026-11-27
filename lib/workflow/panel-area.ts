/**
 * Korten ser likadana ut (2026-10-22, UX-punkt 6): every card (`Panel`) has an icon left of its title, coloured
 * with the same colour per area (the page's function) – the --type-* tokens of the app's icon squares. Inställningar and
 * Installation are the "admin" area in Workflow Blue (--primary): the app's ordinary colour, the same as the
 * menu and the buttons, never an accent of their own (no-accent-colours-for-admin, 2026-10-03). Pure, so the
 * workspace, the tests and the screen test read the same map.
 */
import { typeOfTaskKind, type TypeKey } from "@/lib/workflow/native-mode";
import { isRiskAssessmentTask } from "@/lib/workflow/risk-step";

export type PanelArea = TypeKey | "admin";

/** The colour token of an area. The level-1 helpers (checkin, new, notice) borrow their tile's colour. */
const AREA_TOKEN: Record<PanelArea, string> = {
  "work-order": "--type-work-order", control: "--type-control", risk: "--type-risk", round: "--type-round", time: "--type-time",
  customer: "--type-customer", project: "--type-project", quote: "--type-quote", purchase: "--type-purchase",
  instrument: "--type-instrument", tools: "--type-tools", calendar: "--type-calendar", maintenance: "--type-maintenance", neutral: "--type-neutral",
  checkin: "--type-round", new: "--type-risk", notice: "--type-project",
  admin: "--primary",
};
export const panelAreaColor = (area: PanelArea) => `var(${AREA_TOKEN[area]})`;

/**
 * Svar på de 15 frågorna (2026-10-24): Verktyg and all its pages (Rapportarkiv, Egenkontroll, Instrument, Import,
 * Skapa formulär, Kalkylator) share one slate blue-grey (`tools`, answer 7); Kalender has a colour of its own, apart from
 * Tid's indigo (`calendar`, answer 14).
 */
const VIEW_AREA: Record<string, PanelArea> = {
  stats: "project", notifications: "notice", setup: "admin", help: "admin",
  tasks: "control", new: "control", controls: "control",
  tools: "tools", self_inspection: "tools", forms: "tools", report_archive: "tools", instruments: "tools", calculators: "tools", import: "tools",
  // Webb och inlägg (2026-11-20): a page under Mer, in Verktyg's colour.
  web_posts: "tools", company_posts: "tools", company_website: "tools", company_videos: "tools", agents: "tools",
  // Nyheter (2026-11-21): a page under Mer, in Verktyg's colour.
  news: "tools",
  // Dokument (0.87.0): a page under Mer, in Verktyg's colour.
  documents: "tools",
  work_orders: "work-order", rounds: "round",
  // Avvikelser (2026-10-30): the deviation log, in the colour of risk (tillbud, olycksfall).
  deviations: "risk",
  // Underhåll (2026-10-30): the machine tree, the store and the items, an olive green of its own.
  maintenance: "maintenance",
  // Tavlor (2026-11-18): the company's figures, in Översiktens blue.
  boards: "project",
  projects: "project", project: "project", new_project: "project", project_planning: "project", project_summary: "project",
  planning: "calendar", capacity: "calendar", time: "time",
  customers: "customer", place: "customer", place_labels: "customer", facilities: "customer",
  quotes: "quote", quote: "quote", invoice_bases: "quote", customer_invoices: "quote",
  purchases: "purchase", purchase: "purchase", articles: "purchase",
};

const ADMIN_VIEWS = new Set([
  "settings", "company", "administration", "operator_accounts", "quote_settings", "company_features", "company_values", "ai_settings", "credits",
  "advanced", "company_settings", "integrations", "history_retention",
  "product_overview", "customer_companies", "pricing_admin", "ai_admin", "landing_editor", "pdf_templates", "plc_devices", "mailings", "mail_settings", "login_settings",
  "server_keys", "services", "view_as", "behavior_analytics",
]);


/** The area of a page (?view=), and for a job its kind (?taskType=): a work order red, a risk assessment orange, a protocol violet. */
export function panelAreaOfView(view: string, taskType?: string | null): PanelArea {
  if (view === "workflow_task" || view === "new_task") return taskType ? typeOfTaskKind(taskType) : "control";
  if (ADMIN_VIEWS.has(view)) return "admin";
  return VIEW_AREA[view] ?? "admin";
}

/**
 * The area of a job's cards: its kind's, except that a risk assessment made as the risk form (Workflow's or the company's
 * copy – a new Ny riskbedömning opens it) is orange like the old kind, not violet like a protocol.
 */
export function panelAreaOfTask(task: { kind: string; formArea?: string | null; data: unknown }): PanelArea {
  return task.kind === "FORM" && isRiskAssessmentTask(task) ? "risk" : typeOfTaskKind(task.kind);
}
