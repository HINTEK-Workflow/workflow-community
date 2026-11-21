"use client";
/**
 * Laddtid på mobil (U1/T2, 2026-10-23): the workspace's heavy pages are loaded when they are opened, not with the
 * first page. Before this every view's code came with the first page (≈ 1,25 MB packed JavaScript, about 6–9 s on 3G).
 * The phone's app view stays in the first bundle – Hem (NativeHome), Jobb (TasksPage), Tid (TimeReport) and Mer (the
 * settings menu) – and so do the small parts the pages share.
 *
 * Each page below is a `next/dynamic` component with the same props as before. While its code is on its way the page
 * shows `ViewLoading`: the page's shape in grey (a title bar and a panel of rows, or the app's list rows at level 1), no
 * spinner. `preloadView` starts the code of the page in the address at once, in parallel with the workspace's own read,
 * so the grey shape is seldom seen; `preloadLikely` fetches the job editor when the browser is idle afterwards, so a job
 * opened from Hem or Jobb does not wait for it. Nothing here decides what a person may see: the workspace and the server
 * do, as before.
 */
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { PartLoading, ViewLoading } from "./view-loading";

// The loaders, one per module; webpack makes a chunk of each and fetches it once.
const load = {
  editor: () => import("@/features/workflow/workflow-task-editor"),
  projects: () => import("./workflow-projects"),
  taskTypes: () => import("@/features/workflow/task-type-picker"),
  administration: () => import("./administration"),
  users: () => import("./administration-users"),
  customerCompanies: () => import("./customer-companies"),
  productOverview: () => import("./product-overview"),
  setup: () => import("./setup-guide"),
  local: () => import("./local-workspace"),
  analytics: () => import("./analytics"),
  // Översikten (dashboard etapp 6–7, 2026-10-28): Cloud's new Översikt; Local and the demo keep Analytics.
  overview: () => import("@/features/overview/overview-page"),
  records: () => import("./record-archive"),
  registerSwitch: () => import("@/features/workflow/customer-register-switch"),
  tools: () => import("@/features/workflow/tools-hub"),
  customerCard: () => import("./customer-card"),
  customerEdit: () => import("./customer-edit-page"),
  selfInspection: () => import("@/features/self-inspection/self-inspection-page"),
  instruments: () => import("@/features/self-inspection/instruments"),
  quotes: () => import("@/features/quotes/quotes-list"),
  quote: () => import("@/features/quotes/quote-editor"),
  purchases: () => import("@/features/purchases/purchases-list"),
  maintenance: () => import("@/features/maintenance/maintenance-page"),
  boards: () => import("@/features/boards/boards-page"),
  purchase: () => import("@/features/purchases/purchase-editor"),
  articles: () => import("@/features/purchases/articles-page"),
  invoiceBases: () => import("@/features/invoice-basis/invoice-bases-list"),
  priceSettings: () => import("@/features/quotes/price-settings"),
  accounting: () => import("@/features/quotes/accounting-settings"),
  companyGoals: () => import("@/features/workflow/company-goals-settings"),
  calculators: () => import("@/features/calculators/calculators-page"),
  projectSummary: () => import("@/features/workflow/project-summary"),
  projectPlanning: () => import("@/features/workflow/project-planning"),
  capacity: () => import("@/features/workflow/capacity-page"),
  reportArchive: () => import("@/features/workflow/report-archive"),
  rounds: () => import("@/features/workflow/form-rounds"),
  place: () => import("@/features/workflow/place-page"),
  placeLabels: () => import("@/features/workflow/place-labels"),
  companyValues: () => import("@/features/workflow/company-values"),
  historyRetention: () => import("@/features/workflow/history-retention"),
  mailings: () => import("@/features/workflow/mailings"),
  pdfTemplates: () => import("@/features/pdf-templates/pdf-templates-page"),
  plcDevices: () => import("@/features/plc-devices/plc-devices-page"),
  mailSettings: () => import("@/features/workflow/mail-settings"),
  loginSettings: () => import("@/features/workflow/login-settings"),
  behavior: () => import("@/features/workflow/behavior-analytics"),
  viewAs: () => import("@/features/workflow/view-as-panel"),
  lantmateriet: () => import("@/features/workflow/lantmateriet-settings"),
  microsoft: () => import("@/features/workflow/microsoft-settings"),
  platformSecurity: () => import("@/features/security/platform-security"),
  siteMap: () => import("@/features/workflow/site-map"),
  serverUpdates: () => import("@/features/workflow/server-updates"),
  serverJobs: () => import("@/features/workflow/server-jobs"),
  companySecurity: () => import("@/features/security/company-security"),
  operatorAccounts: () => import("@/features/operator/operator-accounts-admin"),
  operatorProduct: () => import("@/features/operator/operator-product-settings"),
  providerKey: () => import("@/features/ai/provider-key-panel"),
};

// The pages, by the workspace's views.
export const WorkflowTaskEditor = dynamic(() => load.editor().then((module) => module.WorkflowTaskEditor), { loading: ViewLoading });
export const WorkflowProjects = dynamic(() => load.projects().then((module) => module.WorkflowProjects), { loading: ViewLoading });
export const TaskTypePicker = dynamic(() => load.taskTypes().then((module) => module.TaskTypePicker), { loading: ViewLoading });
export const Administration = dynamic(() => load.administration().then((module) => module.Administration), { loading: ViewLoading });
export const UsersAdministration = dynamic(() => load.users().then((module) => module.UsersAdministration), { loading: ViewLoading });
export const CustomerCompanies = dynamic(() => load.customerCompanies().then((module) => module.CustomerCompanies), { loading: ViewLoading });
export const ProductOverviewPage = dynamic(() => load.productOverview().then((module) => module.ProductOverviewPage), { loading: ViewLoading });
export const SandboxBillingPanel = dynamic(() => load.customerCompanies().then((module) => module.SandboxBillingPanel), { loading: PartLoading });
export const SetupGuide = dynamic(() => load.setup().then((module) => module.SetupGuide), { loading: ViewLoading });
// Local keeps its pages in its own file; the workspace draws nothing of it until the overview says LOCAL.
export const LocalWorkspace = dynamic(() => load.local().then((module) => module.LocalWorkspace), { loading: ViewLoading });
export const Analytics = dynamic(() => load.analytics().then((module) => module.Analytics), { loading: ViewLoading });
export const OverviewPage = dynamic(() => load.overview().then((module) => module.OverviewPage), { loading: ViewLoading });
export const CustomerRegisterSwitch = dynamic(() => load.registerSwitch().then((module) => module.CustomerRegisterSwitch), { loading: ViewLoading });
export const ToolsHub = dynamic(() => load.tools().then((module) => module.ToolsHub), { loading: ViewLoading });
export const RecordArchive = dynamic(() => load.records().then((module) => module.RecordArchive), { loading: ViewLoading });
export const CustomerCard = dynamic(() => load.customerCard().then((module) => module.CustomerCard), { loading: ViewLoading });
export const CustomerEditPage = dynamic(() => load.customerEdit().then((module) => module.CustomerEditPage), { loading: ViewLoading });
// Egenkontroll and Instrument in Cloud (the workspace's names kept): one backend for the page's lifetime, made when the code has come.
export const SelfInspectionPage = dynamic(() => load.selfInspection().then((module) => {
  const backend = module.cloudSelfInspectionBackend();
  return function CloudSelfInspection(props: Omit<ComponentProps<typeof module.SelfInspectionPage>, "backend">) { return <module.SelfInspectionPage backend={backend} {...props} />; };
}), { loading: ViewLoading });
export const InstrumentsPage = dynamic(() => load.instruments().then((module) => {
  const backend = module.cloudInstrumentsBackend();
  return function CloudInstruments() { return <module.InstrumentsPage backend={backend} />; };
}), { loading: ViewLoading });
export const QuotesList = dynamic(() => load.quotes().then((module) => module.QuotesList), { loading: ViewLoading });
export const QuoteEditorFromAddress = dynamic(() => load.quote().then((module) => module.QuoteEditorFromAddress), { loading: ViewLoading });
export const PurchasesList = dynamic(() => load.purchases().then((module) => module.PurchasesList), { loading: ViewLoading });
export const MaintenancePage = dynamic(() => load.maintenance().then((module) => module.MaintenancePage), { loading: ViewLoading });
export const BoardsPage = dynamic(() => load.boards().then((module) => module.BoardsPage), { loading: ViewLoading });
export const PurchaseEditorFromAddress = dynamic(() => load.purchase().then((module) => module.PurchaseEditorFromAddress), { loading: ViewLoading });
export const InvoiceBasesList = dynamic(() => load.invoiceBases().then((module) => module.InvoiceBasesList), { loading: ViewLoading });
export const ArticlesPage = dynamic(() => load.articles().then((module) => module.ArticlesPage), { loading: ViewLoading });
export const PriceSettingsPanel = dynamic(() => load.priceSettings().then((module) => module.PriceSettingsPanel), { loading: PartLoading });
export const AccountingSettingsPanel = dynamic(() => load.accounting().then((module) => module.AccountingSettingsPanel), { loading: PartLoading });
export const CompanyGoalsPanel = dynamic(() => load.companyGoals().then((module) => module.CompanyGoalsPanel), { loading: PartLoading });
export const CalculatorsPage = dynamic(() => load.calculators().then((module) => module.CalculatorsPage), { loading: ViewLoading });
export const ProjectSummaryPage = dynamic(() => load.projectSummary().then((module) => module.ProjectSummaryPage), { loading: ViewLoading });
export const ProjectPlanningPage = dynamic(() => load.projectPlanning().then((module) => module.ProjectPlanningPage), { loading: ViewLoading });
export const CapacityPage = dynamic(() => load.capacity().then((module) => module.CapacityPage), { loading: ViewLoading });
export const ReportArchive = dynamic(() => load.reportArchive().then((module) => module.ReportArchive), { loading: ViewLoading });
export const FormRounds = dynamic(() => load.rounds().then((module) => module.FormRounds), { loading: ViewLoading });
export const PlacePage = dynamic(() => load.place().then((module) => module.PlacePage), { loading: ViewLoading });
export const PlaceLabels = dynamic(() => load.placeLabels().then((module) => module.PlaceLabels), { loading: ViewLoading });
export const PlaceLabelsMoved = dynamic(() => load.placeLabels().then((module) => module.PlaceLabelsMoved), { loading: ViewLoading });
export const CloudCompanyValues = dynamic(() => load.companyValues().then((module) => {
  return function CloudValues(props: Omit<ComponentProps<typeof module.CompanyValues>, "backend">) { return <module.CompanyValues backend={module.cloudCompanyValues} {...props} />; };
}), { loading: ViewLoading });
export const HistoryRetention = dynamic(() => load.historyRetention().then((module) => module.HistoryRetention), { loading: PartLoading });
// Installation and the company's security and settings parts: admins and the superadmin only.
export const PdfTemplatesPage = dynamic(() => load.pdfTemplates().then((module) => module.PdfTemplatesPage), { loading: PartLoading });
export const PlcDevicesPage = dynamic(() => load.plcDevices().then((module) => module.PlcDevicesPage), { loading: PartLoading });
export const Mailings = dynamic(() => load.mailings().then((module) => module.Mailings), { loading: PartLoading });
export const MailSettings = dynamic(() => load.mailSettings().then((module) => module.MailSettings), { loading: PartLoading });
export const LoginSettings = dynamic(() => load.loginSettings().then((module) => module.LoginSettings), { loading: PartLoading });
export const CompanyLookupSettings = dynamic(() => load.loginSettings().then((module) => module.CompanyLookupSettings), { loading: PartLoading });
export const BehaviorAnalytics = dynamic(() => load.behavior().then((module) => module.BehaviorAnalytics), { loading: ViewLoading });
export const ViewAsPanel = dynamic(() => load.viewAs().then((module) => module.ViewAsPanel), { loading: PartLoading });
export const LantmaterietSettings = dynamic(() => load.lantmateriet().then((module) => module.LantmaterietSettings), { loading: PartLoading });
export const MicrosoftSignInSettings = dynamic(() => load.microsoft().then((module) => module.MicrosoftSignInSettings), { loading: PartLoading });
export const PlatformSecurity = dynamic(() => load.platformSecurity().then((module) => module.PlatformSecurity), { loading: PartLoading });
export const PlatformSecurityLog = dynamic(() => load.platformSecurity().then((module) => module.PlatformSecurityLog), { loading: PartLoading });
// Webbplatskartan under Avancerat on Drift och säkerhet: its code comes when the part is drawn, its data when asked for.
export const SiteMap = dynamic(() => load.siteMap().then((module) => module.SiteMap), { loading: PartLoading });
// Servrar och uppdateringar on Drift och säkerhet (2026-10-25): the servers' status, read when the part is drawn.
export const ServerUpdates = dynamic(() => load.serverUpdates().then((module) => module.ServerUpdates), { loading: PartLoading });
export const ServerJobs = dynamic(() => load.serverJobs().then((module) => module.ServerJobs), { loading: PartLoading });
export const CompanySecurity = dynamic(() => load.companySecurity().then((module) => module.CompanySecurity), { loading: PartLoading });
// Operatörskonton (2026-10-30; a menu button of its own 2026-10-31), Cloud admins.
export const OperatorAccountsAdmin = dynamic(() => load.operatorAccounts().then((module) => module.OperatorAccountsAdmin), { loading: ViewLoading });
export const OperatorProductSettings = dynamic(() => load.operatorProduct().then((module) => module.OperatorProductSettings), { loading: PartLoading });
export const ProviderKeyPanel = dynamic(() => load.providerKey().then((module) => module.ProviderKeyPanel), { loading: PartLoading });

type Loader = () => Promise<unknown>;
// Which code a view's page needs; a view that is not here is in the first bundle (or loads its parts itself).
const VIEW_CODE: Record<string, Loader[]> = {
  workflow_task: [load.editor],
  new_task: [load.taskTypes],
  new_project: [load.projects], projects: [load.projects], planning: [load.projects], project: [load.projects],
  administration: [load.users, load.companySecurity],
  operator_accounts: [load.operatorAccounts],
  company: [load.administration], company_settings: [load.administration], credits: [load.administration],
  customer_companies: [load.customerCompanies],
  product_overview: [load.productOverview],
  setup: [load.setup],
  customers: [load.registerSwitch, load.records, load.customerCard], tools: [load.tools],
  self_inspection: [load.selfInspection], instruments: [load.instruments],
  quotes: [load.quotes], quote: [load.quote], purchases: [load.purchases], maintenance: [load.maintenance], boards: [load.boards], purchase: [load.purchase], articles: [load.articles], invoice_bases: [load.invoiceBases],
  company_features: [load.priceSettings, load.accounting, load.companyGoals], quote_settings: [load.priceSettings, load.accounting], ai_settings: [load.priceSettings, load.accounting],
  calculators: [load.calculators], project_summary: [load.projectSummary], project_planning: [load.projectPlanning], capacity: [load.capacity],
  report_archive: [load.reportArchive], rounds: [load.rounds], place: [load.place], place_labels: [load.placeLabels],
  company_values: [load.companyValues], history_retention: [load.administration, load.historyRetention],
  mailings: [load.mailings], behavior_analytics: [load.behavior], pdf_templates: [load.pdfTemplates], plc_devices: [load.plcDevices],
  login_settings: [load.loginSettings, load.mailSettings, load.platformSecurity, load.viewAs], view_as: [load.loginSettings, load.mailSettings, load.platformSecurity, load.viewAs],
  server_keys: [load.loginSettings, load.microsoft, load.lantmateriet, load.mailSettings, load.providerKey],
  services: [load.loginSettings, load.microsoft, load.lantmateriet, load.mailSettings, load.providerKey],
  mail_settings: [load.loginSettings, load.microsoft, load.lantmateriet, load.mailSettings, load.providerKey],
};

/** Starts the code of the page in the address (and Översikt's on a computer) without waiting for it. */
export function preloadView(view: string, options: { native: boolean }) {
  const loaders = [...(VIEW_CODE[view] ?? []), ...(view === "stats" && !options.native ? [load.overview, load.analytics] : [])];
  for (const loader of loaders) void loader().catch(() => undefined);
}

/** When the browser is idle after the first page: the job editor, which Hem and Jobb open next. */
export function preloadLikely() {
  const run = () => void load.editor().catch(() => undefined);
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 5000 }); else window.setTimeout(run, 3000);
}
