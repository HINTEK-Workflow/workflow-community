// The boundary between the core and HINTEK's commercial part in ee/ (Fas 2, 2026-09-30). The core only ever reaches
// ee/ through "@ee/server", "@ee/client" and "@ee/present"; without ee/ they resolve to lib/extensions/none/*.
// Without ee/ (the community edition): no payment, unlimited use and no landing page. Workflow AI, the API and MCP are
// part of the core with the installation's own keys (2026-10-03).
import type { ComponentType, ReactNode } from "react";

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
  | "billing" | "billing/discount-preview" | "billing/invoice"
  | "pricing" | "administration/pricing" | "administration/price-versions"
  | "superadmin/accounting-export" | "superadmin/bank-payments" | "superadmin/invoice-replacements";

export type CloudWriteAccess = {
  allowed: boolean;
  billingManaged: boolean;
  hasActiveEntitlement: boolean;
  hasPaymentGrace: boolean;
  blockingInvoiceIds: string[];
  reason: "AVAILABLE" | "PAYMENT_OVERDUE" | "NO_VALID_CLOUD_RIGHT";
};

export type LandingDecision = { kind: "render"; node: ReactNode } | { kind: "hidden" };

export type ServerExtensions = {
  /** Loaded on first use, so ee/ routes never become part of the core's module graph at start. */
  routes: Partial<Record<EeRouteKey, () => Promise<RouteHandlers>>>;
  /** Whether a company may write to its cloud data (paid subscription, overdue invoices). */
  cloudWriteAccess(organizationId: string, now: Date): Promise<CloudWriteAccess>;
  /** Keeps the paid seats in step with the active members. */
  syncCloudSeats(input: { organizationId: string; actorId: string; reason: string }): Promise<unknown>;
  /** Re-plans the notices about purchased credits that expire. */
  syncCreditExpiryNotices(organizationId: string): Promise<unknown>;
  /** Whether Workflow AI's control review can run and whether a model provider is configured (workspace overview). */
  aiOverview(): Promise<{ enabled: boolean; configured: boolean }>;
  paymentSandboxAvailable(): Promise<boolean>;
  /** Asks Stripe whether it accepts the configured secret key; null without ee/. */
  checkStripeSecretKey(): Promise<{ ok: boolean; message: string } | null>;
  /** HINTEK's published legal document by key; null without ee/ (the installation's own texts are used instead). */
  legalDocument(key: string): Promise<{ title: string; version: string; content: string } | null>;
  /** The public landing page for a signed-out visitor, or a superadmin's preview. */
  landing(input: { superadmin: boolean; preview: boolean }): Promise<LandingDecision>;
  /** The page where a company admin approves an app that wants to use the MCP server (OAuth 2.1); hidden without ee/. */
  oauthAuthorize(params: Record<string, string | undefined>): Promise<LandingDecision>;
};

export type NotifyFn = (message: string, isError?: boolean) => void;

/** A question from the decision support, with the step the person stands on (kinds and steps only, never names). */
export type AssistantAsk = { id: number; question: string; page: unknown };

export type ClientExtensions = {
  /** Fakturering och köp for a company admin; null without ee/. */
  BillingRead: ComponentType<{ endpoint?: string; sandboxQa?: boolean }> | null;
  /** Priser och erbjudanden under Produktadministration. */
  PricingAdministration: ComponentType<{ notify: NotifyFn }> | null;
  /** The landing page's inline editor. */
  LandingEditor: ComponentType | null;
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
  ProtocolReview: ComponentType<{ taskId?: string; controlId?: string; disabled?: boolean; unsaved?: string }> | null;
  AssistantPanel: ComponentType<{ open: boolean; expanded: boolean; onOpenChange: (open: boolean) => void; onExpandedChange: (expanded: boolean) => void; ask?: AssistantAsk | null }> | null;
  SharingPolicyPanel: ComponentType | null;
  ProviderAdministration: ComponentType | null;
  AiUsageAdministration: ComponentType | null;
  /** API och MCP: the company's keys and connected apps. */
  IntegrationKeys: ComponentType<{ notify: NotifyFn }> | null;
  /** Produktadministration → Servernycklar: the keys HINTEK's server runs with, status only (superadmin). */
  ServerKeysAdministration: ComponentType<{ notify: NotifyFn }> | null;
  /** The person's own apps connected to the MCP server through OAuth (Mina inställningar), with disconnect. */
  MyAppConnections: ComponentType<{ notify: NotifyFn }> | null;
  /** The Import page (2026-10-01): files become customers, projects, work orders, planning, control points or attachments; rule- and AI-driven. */
  ImportPage: ComponentType<{ canBuildForms?: boolean }> | null;
};
