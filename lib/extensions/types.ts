// The boundary between the core and Workflow's commercial part in ee/ (Fas 2, 2026-09-30). The core only ever reaches
// ee/ through "@ee/server", "@ee/client" and "@ee/present"; without ee/ they resolve to lib/extensions/none/*.
// Without ee/ (the community edition): no payment, unlimited use and no landing page. Workflow AI, the API and MCP are
// part of the core with the installation's own keys (2026-10-03).
import type { ComponentType, ReactNode } from "react";
import type { CentralField } from "@/lib/secrets/central-fields";
import type { SaveResult } from "@/lib/secrets/central-store";
import type { Context } from "@/lib/kfid/server";
import type { ServerKeyStatus } from "@/lib/integrations/server-keys";

export type RouteContext = { params: Promise<Record<string, string>> };
/** Method syntax on purpose: a handler may narrow its params, e.g. { params: Promise<{ id: string }> }. */
export type RouteHandlers = {
  GET?(request: Request, context: RouteContext): Response | Promise<Response>;
  POST?(request: Request, context: RouteContext): Response | Promise<Response>;
  PUT?(request: Request, context: RouteContext): Response | Promise<Response>;
  PATCH?(request: Request, context: RouteContext): Response | Promise<Response>;
  DELETE?(request: Request, context: RouteContext): Response | Promise<Response>;
  OPTIONS?(request: Request, context: RouteContext): Response | Promise<Response>;
};

/** The app routes that only exist with ee/; their files in app/ answer 404 without it. */
export type EeRouteKey =
  | "stripe/checkout" | "stripe/portal" | "stripe/webhook"
  | "billing" | "billing/discount-preview" | "billing/invoice" | "billing/tier"
  | "pricing" | "administration/pricing" | "administration/price-versions"
  | "superadmin/accounting-export" | "superadmin/bank-payments" | "superadmin/invoice-replacements"
  | "analytics/event" | "landing-images" | "administration/landing-images" | "landing-films" | "administration/landing-films" | "administration/personal-films" | "newsletter/subscribe"
  | "report" | "superadmin/report-settings" | "security.txt";

export type CloudWriteAccess = {
  allowed: boolean;
  billingManaged: boolean;
  hasActiveEntitlement: boolean;
  hasPaymentGrace: boolean;
  blockingInvoiceIds: string[];
  reason: "AVAILABLE" | "PAYMENT_OVERDUE" | "NO_VALID_CLOUD_RIGHT";
};

/**
 * Radering efter avslut (2026-10-10): where a company's Cloud agreement stands, as billing sees it. Only ENDED
 * starts the countdown to automatic erasure; NOT_BILLING (Local, Community, demo, no billing at all), ACTIVE and
 * UNSETTLED (a payment problem, an open subscription or an unpaid Cloud invoice) never lead to erasure.
 */
export type CloudAgreementState =
  | { state: "NOT_BILLING" }
  | { state: "ACTIVE" }
  | { state: "UNSETTLED"; reason: "PAYMENT_OVERDUE" | "OPEN_SUBSCRIPTION" | "UNPAID_INVOICE" }
  | { state: "ENDED"; endedAt: Date };

/**
 * The landing page's own search and share settings (Sökmotorer, 2026-11-10), edited in the landing editor. Empty texts
 * mean the installation's defaults (lib/site-metadata.ts); `image` null means the generated share picture.
 */
export type LandingSeo = { title: string; description: string; image: { url: string; alt: string } | null; googleVerification: string };

export type LandingDecision = { kind: "render"; node: ReactNode; seo?: LandingSeo } | { kind: "hidden" };

/** A company's payment as the superadmin sees it (beslut 11, 2026-11-01): metadata from the stored Stripe data; dates as ISO text. */
export type CompanyPayment = {
  status: "PAID" | "FAILED" | "OVERDUE" | "TRIAL" | "TEST" | "ENDED" | "NONE";
  problemSince: string | null;
  problemOre: number;
  nextInvoiceAt: string | null;
  nextInvoiceOre: number | null;
  lastPaymentAt: string | null;
  lastPaymentOre: number | null;
};

/**
 * Min webbsida (2026-11-10): what an extension adds to one company's own site – its pages first, and blocks Workflow keeps
 * up to date there itself. The core hands `sources` to the editor unread and shows `status` and `error` as they are.
 */
export type WebsiteExtras = {
  firstPages: number[];
  sources: unknown;
  status?: string | null;
  error?: string | null;
  /** Writes the automatic blocks now (the editor's own button); its answer is shown as it is. */
  run(): Promise<unknown>;
};

/** The editor's side of WebsiteExtras: the block kinds, how a block is recognised and written (pure; loaded on first use). */
export type WebsiteAutoClient = {
  kinds: { kind: string; label: string; short: string; hint: string; icon: import("lucide-react").LucideIcon }[];
  /** Which kind a block is bound to, or null. */
  kindOf(block: import("@/lib/website/blocks").BlockNode): string | null;
  /** The markup of a new group bound to the kind, filled from the sources when they are there. */
  newGroup(kind: string, sources: unknown): string;
  /** The block bound to the kind (null: to none), its content written from the sources. */
  bind(block: import("@/lib/website/blocks").BlockNode, kind: string | null, sources: unknown): import("@/lib/website/blocks").BlockNode;
  /** A short line under the choice (why nothing is written yet, or what happens). */
  note(kind: string | null, sources: unknown): string;
};

/** Workflow's key vault copy of the central keys (2026-10-25; outside the core since 2026-11-10): the core hands it each save. */
export type CentralKeyCopy = {
  /** After a save sealed here and marked as owed: copies it, or leaves it owed. */
  saved(field: CentralField, at: string): Promise<SaveResult>;
  /** After a removal here of a key linked to the copy (its id there). */
  removed(field: CentralField, id: string): Promise<SaveResult>;
};

/** What Tjänster och nycklar hands the extension: the page's rows, their real check and the overview it answers with. */
export type CentralKeysDeps = {
  serverKeys: (organizationId: string) => Promise<ServerKeyStatus[]>;
  checkServerKey: (status: ServerKeyStatus, actor: string) => Promise<{ ok: boolean; message: string }>;
  overview: () => Promise<unknown>;
};

/**
 * Workflow's own routines around the central keys (ee/secrets, moved out of the core 2026-11-10): the key vault's copy,
 * Kontrollera och synka, the emergency copy and the restore drill. Absent without ee/: the core keeps the sealed copy and
 * its own check that every sealed value can be opened.
 */
export type CentralKeysExtension = {
  /** null in database mode (CENTRAL_SECRET_STORE is not "vault"). */
  copy: CentralKeyCopy | null;
  /** Central lagring's overview beyond the core's own: replaces `store` and adds the emergency copy and the sync button. */
  overview(): Promise<Record<string, unknown>>;
  /** The key vault's part of Central lagring → Kontrollera, or null without a vault. */
  check(): Promise<{ ok: boolean; text: string } | null>;
  /** Its own commands on /api/integration-keys; null when the command is not one of them. */
  command(raw: unknown, ctx: Context, deps: CentralKeysDeps, headers: Headers): Promise<Response | null>;
  /** secrets:sync: the vault's comparison and alarms, and the emergency copy; the line for the log. */
  job(now: Date, alarm: (subject: string, text: string) => Promise<void>): Promise<string>;
};

/** Uppdatera servrarna med ett klick (2026-11-06; ee/ since 2026-11-10): the handler links and the manual commands. */
export type ServerOps = {
  /** The command that reads a server's status again, under "Kommandon för hand", per host. */
  statusCommands: Readonly<Record<string, string>>;
  /** The links to the handler on the administrator's own computer, or null. */
  oneClick: { updateAll: string; restart: Record<string, string>; install: string } | null;
};

export type ServerExtensions = {
  /** Loaded on first use, so ee/ routes never become part of the core's module graph at start. */
  routes: Partial<Record<EeRouteKey, () => Promise<RouteHandlers>>>;
  /** Whether a company may write to its cloud data (paid subscription, overdue invoices). */
  cloudWriteAccess(organizationId: string, now: Date): Promise<CloudWriteAccess>;
  /** Whether the company's Cloud agreement has ended, and when (automatic erasure after the end); NOT_BILLING without ee/. */
  cloudAgreementState(organizationId: string, now: Date): Promise<CloudAgreementState>;
  /** Whether the installation has payment at all (false without ee/). */
  hasPayments: boolean;
  /** Each company's payment for the superadmin, from stored data; empty without ee/. */
  companyPayments(organizationIds: readonly string[], now: Date): Promise<Record<string, CompanyPayment>>;
  /** Keeps the paid seats in step with the active members. */
  syncCloudSeats(input: { organizationId: string; actorId: string; reason: string }): Promise<unknown>;
  /**
   * Prissteg (2026-11-20): the line the company admin sees after an invitation when the users then pass the price step
   * (no block, only the line); null when nothing needs saying, and always without ee/.
   */
  cloudTierNotice(organizationId: string): Promise<string | null>;
  /** Re-plans the notices about purchased credits that expire. */
  syncCreditExpiryNotices(organizationId: string): Promise<unknown>;
  /** Whether Workflow AI's control review can run and whether a model provider is configured (workspace overview). */
  aiOverview(): Promise<{ enabled: boolean; configured: boolean }>;
  /** What one AI credit is worth (öre) in the active price version, which AI runs are priced against; null without ee/. */
  aiCreditValueOre(): Promise<number | null>;
  paymentSandboxAvailable(): Promise<boolean>;
  /** Asks Stripe whether it accepts the configured secret key; null without ee/. */
  checkStripeSecretKey(): Promise<{ ok: boolean; message: string } | null>;
  /** Workflow's published legal document by key; null without ee/ (the installation's own texts are used instead). */
  legalDocument(key: string): Promise<{ title: string; version: string; content: string } | null>;
  /** The public landing page for a signed-out visitor, or a superadmin's preview. */
  landing(input: { superadmin: boolean; preview: boolean }): Promise<LandingDecision>;
  /**
   * The public site's top and footer for the text pages (the legal documents, 2026-11-11): Workflow's, the same as the
   * landing page's, while the landing page is published; null otherwise and without ee/ (the page then has its own plain links).
   */
  publicChrome?(): Promise<{ header: ReactNode; footer: ReactNode } | null>;
  /**
   * The links back to the company's site and the product's site on a signed-in person's legal page (2026-11-12), from the
   * owner's own top (the landing editor's Sidhuvud); empty without ee/ or without such a top (the page then offers Till startsidan).
   */
  publicSiteLinks?(): Promise<{ label: string; href: string }[]>;
  /**
   * A feature page (/funktioner/<adress>, 2026-11-14) while the landing page is published and the page is shown; a
   * superadmin also sees a hidden one (as the editor's preview). Hidden, unknown and without ee/: the route answers 404.
   */
  landingPage?(input: { slug: string; superadmin: boolean }): Promise<{ kind: "render"; node: ReactNode; seo: import("@/lib/site-metadata").FeaturePageSeo; indexable: boolean } | { kind: "hidden" }>;
  /**
   * The film page (/filmer, 2026-11-20): every film on the landing pages, while the landing page is published, the film page
   * is switched on and has a film; a superadmin also sees it otherwise. Without ee/: the route answers 404. `slug` (2026-11-24): a
   * film's own address, /filmer/<kortnamn>; the page then opens that film (an unknown one shows the page with a short line).
   */
  landingFilms?(input: { superadmin: boolean; slug?: string }): Promise<{ kind: "render"; node: ReactNode; seo: import("@/lib/site-metadata").FeaturePageSeo; indexable: boolean } | { kind: "hidden" }>;
  /**
   * Filmlistan (2026-11-25, list_films): the films a visitor sees on /filmer, as data – the film's address, name, line, its own page and
   * its poster – while the film page is open; an empty list otherwise. Without ee/: no list.
   */
  landingFilmList?(): Promise<{ slug: string; title: string; line: string; url: string; poster: string | null }[]>;
  /**
   * Personlig filmlänk (2026-11-26): /film/<token> – a greeting clip and then one of the landing page's films, for one person. Never
   * indexed. `count` adds a view (not for the superadmin, link previews or the page's metadata). An unknown, revoked or expired link
   * gives the page that says the link no longer works (`title` null); without ee/ the address answers 404.
   */
  personalFilm?(input: { token: string; count: boolean }): Promise<{ node: ReactNode; title: string | null }>;
  /**
   * The news page (/nytt, 2026-11-20, Nytt i systemet): the latest versions out of lib/release-notes.ts, while the landing page
   * is published and the page is switched on; a superadmin also sees it otherwise. Without ee/: the route answers 404.
   */
  landingNews?(input: { superadmin: boolean }): Promise<{ kind: "render"; node: ReactNode; seo: import("@/lib/site-metadata").FeaturePageSeo; indexable: boolean } | { kind: "hidden" }>;
  /** The addresses of the feature pages (the film page and the news page too) visitors may open, for the sitemap; empty while the landing page is hidden. */
  landingPagePaths?(): Promise<string[]>;
  /** The page where a company admin approves an app that wants to use the MCP server (OAuth 2.1); hidden without ee/. */
  oauthAuthorize(params: Record<string, string | undefined>): Promise<LandingDecision>;
  /** Workflow's key vault copy, Kontrollera och synka and the emergency copy (CentralKeysExtension); absent without ee/. */
  centralKeys?(): Promise<CentralKeysExtension>;
  /** Workflow's servers: the manual status commands and the one-click handler (ServerOps); absent without ee/. */
  serverOps?(): Promise<ServerOps>;
  /** Min webbsida: what ee/ adds to this company's own site, or null; absent without ee/. */
  websiteExtras?(organizationId: string): Promise<WebsiteExtras | null>;
  /** Called once when the server process starts (instrumentation.ts); absent without ee/. Never throws. */
  serverStarted?(): void;
};

export type NotifyFn = (message: string, isError?: boolean) => void;

/**
 * Workflow's Central lagring (ee/ui, 2026-11-10 out of the core): the panel with the key vault's copy, the overview's status
 * and Kontrollera och synka. `overview` is what /api/integration-keys?scope=server answers under `central`.
 */
export type CentralKeysUi = {
  Panel: ComponentType<{ central: unknown; notify: NotifyFn; onChanged: (central: unknown) => void }>;
  state: (central: unknown) => import("@/features/integrations/server-key-status").ServerKeySectionStatus | undefined;
  SyncButton: ComponentType<{ notify: NotifyFn; onDone: (central: unknown, server: unknown) => void }>;
  /** Whether the overview offers Kontrollera och synka. */
  syncAvailable: (central: unknown) => boolean;
};

/** A question from the decision support, with the step the person stands on (kinds and steps only, never names). */
export type AssistantAsk = { id: number; question: string; page: unknown };

export type ClientExtensions = {
  /** Fakturor (2026-11-04; in the core since 2026-11-10, so Community has them too): the company's list, its way in from the list of bases, the action on a basis and the setting. */
  CustomerInvoices: ComponentType<{ personId?: string }> | null;
  /** Nytt fakturaunderlag (Lika är rätt, 2026-11-14): `onNew` opens an empty basis that `create` saves at its first change. */
  CustomerInvoicesLink: ComponentType<{ onNew?: (start: { create: (input: { customerId: string | null; title: string }) => Promise<{ id: string; label: string }> }) => void }> | null;
  InvoiceFromBasis: ComponentType<{ basisId: string; dirty: boolean; /** Why no invoice can be made from what the page shows (no rows). */ blocked?: string | null; onChanged: () => void }> | null;
  InvoiceOfBasisStatus: ComponentType<{ basisId: string }> | null;
  CustomerInvoiceSettings: ComponentType | null;
  CustomerInvoiceDisclosure: ComponentType | null;
  CustomerInvoiceLinkView: ComponentType<{ token: string; initial: import("@/lib/customer-invoice/model").PublicInvoicePage }> | null;
  /** Rapportera fel eller förslag (2026-11-13): the public form and its GitHub key card on Tjänster och nycklar; null without ee/. */
  ReportForm: ComponentType<{ source?: "demo"; page?: string }> | null;
  IssueReportSettings: ComponentType<{ notify: NotifyFn }> | null;
  /** Uppdatera servrarna med ett klick (Workflow's handler on the administrator's computer, ee/ui/server-one-click.tsx); null without ee/. */
  ServerOneClickRow: ComponentType<{ oneClick: import("@/lib/ops/host-status").ServerOneClick; unknown: readonly string[] }> | null;
  /** Workflow's key vault on Central lagring (ee/ui/central-store-panel.tsx), loaded with the page's data; null without ee/. */
  loadCentralKeysUi: (() => Promise<CentralKeysUi>) | null;
  /** Fakturering och köp for a company admin; null without ee/. */
  BillingRead: ComponentType<{ endpoint?: string; sandboxQa?: boolean }> | null;
  /** Priser och erbjudanden under Installation. */
  PricingAdministration: ComponentType<{ notify: NotifyFn }> | null;
  /** Fakturor och bokföring under Kundföretag: Workflow's own invoices and credits for the accountant. */
  AccountingExport: ComponentType | null;
  /** The landing page's inline editor. */
  LandingEditor: ComponentType | null;
  /** Min webbsida: the extension's automatic blocks for the editor, loaded when the server says they apply; null without ee/. */
  loadWebsiteAuto: (() => Promise<WebsiteAutoClient>) | null;
  /** Trattmätning (2026-10-07): counts that a public page was reached, once per step, only after the visitor allowed statistics; null without ee/. */
  FunnelBeacon: ComponentType<{ step: import("@/lib/analytics/catalog").FunnelStep; watchPricing?: boolean }> | null;
  /** Skapa konto (prissteg 2026-11-20): what Cloud costs after the trial, once the prices are published; null without ee/. */
  RegisterPriceNote: ComponentType | null;
  /** Workflow AI: the assistant in the shell, the company's sharing choices, and the product owner's provider and usage views. */
  /** `ask`: a question from a tip's "Fråga Workflow AI", sent with the page's step (2026-10-01). */
  /** "Skriv med AI" beside Sammanställ resultat (2026-10-01); null in the community edition. */
  /** `current`: the field's text now (an empty field may be filled directly; a written one gets a proposal). */
  SummaryAssist: ComponentType<{ draft: string; label: string; onText: (text: string) => void; disabled?: boolean; current?: string; sourceId?: string }> | null;
  /** Workflow AI's proposals (2026-10-02): a work order from a task's deviations, measures for a risk assessment's risks and planning for a project's tasks. Nothing is created until the person confirms. */
  /** `task`: the task as the page holds it; the button is shown only when it has deviations to act on. */
  WorkOrderProposal: ComponentType<{ taskId: string; task: Record<string, unknown>; disabled?: boolean }> | null;
  RiskMeasuresAssist: ComponentType<{ title: string; taskId?: string; risks: { id: string; hazard: string; likelihood: number; consequence: number }[]; onApply: (measures: { riskId: string; measure: string }[]) => () => void; disabled?: boolean }> | null;
  PlanningProposal: ComponentType<{ projectId: string; disabled?: boolean; onApplied?: () => void }> | null;
  /** Dagsammanställningen on Översikt (2026-10-02): the night's short digest of the day before, for the team. */
  DailyDigestCard: ComponentType | null;
  /** "Granska med AI" (2026-10-02): the reviewer reads a saved protocol or control and points at what to check; it changes nothing. `unsaved`: why it cannot be reviewed right now. */
  ProtocolReview: ComponentType<{ taskId?: string; disabled?: boolean; unsaved?: string }> | null;
  AssistantPanel: ComponentType<{ open: boolean; expanded: boolean; onOpenChange: (open: boolean) => void; onExpandedChange: (expanded: boolean) => void; ask?: AssistantAsk | null }> | null;
  /** Workflow AI's choices for the company; `embedded` as a part of Inställningar → Arbetssätt (2026-10-15), without its own page heading. */
  SharingPolicyPanel: ComponentType<{ embedded?: boolean }> | null;
  /** Workflow AI:s leverantör (C6): part="service" on Tjänster och nycklar, part="cost" under Priser → Avancerat. */
  ProviderAdministration: ComponentType<{ part?: "service" | "cost" }> | null;
  AiUsageAdministration: ComponentType | null;
  /** Kopplingar (2026-10-31): the overview of the company's connections, or one area's page (`area` = the address's ?section=). */
  /** `simulator`: show the PLC simulator's button under Maskiner – only in the demo and for the product owner (2026-11-20). */
  IntegrationKeys: ComponentType<{ notify: NotifyFn; area?: string | null; simulator?: boolean }> | null;
  /** Installation → Servernycklar: the keys Workflow's server runs with, status only (superadmin). */
  ServerKeysAdministration: ComponentType<{ notify: NotifyFn; parts?: { scb?: ReactNode; map?: ReactNode; address?: ReactNode; microsoft?: ReactNode; github?: ReactNode }; payments?: ReactNode;
    extras?: Partial<Record<string, (refresh: () => void, row: { serviceSwitch?: { on: boolean } }, bindCheck: (handler: (() => Promise<void>) | null) => void) => ReactNode>>; after?: Partial<Record<string, ReactNode>> }> | null;
  /** The person's own apps connected to the MCP server through OAuth (Mina inställningar), with disconnect. */
  MyAppConnections: ComponentType<{ notify: NotifyFn }> | null;
  /** The Import page (2026-10-01): files become customers, projects, work orders, planning, control points or attachments; rule- and AI-driven. */
  ImportPage: ComponentType<{ canBuildForms?: boolean; canImportArticles?: boolean }> | null;
};
