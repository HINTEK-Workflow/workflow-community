// The boundary between the core and HINTEK's commercial part in ee/ (Fas 2, 2026-09-30). The core only ever reaches
// ee/ through "@ee/server", "@ee/client" and "@ee/present"; without ee/ they resolve to lib/extensions/none/*.
// Without ee/ (the community edition): no payment, unlimited use, no landing page, and no HINTEK AI, API or MCP
// server (2026-09-30).
import type { ComponentType, ReactNode } from "react";

export type RouteContext = { params: Promise<Record<string, string>> };
/** Method syntax on purpose: a handler may narrow its params, e.g. { params: Promise<{ id: string }> }. */
export type RouteHandlers = {
  GET?(request: Request, context: RouteContext): Response | Promise<Response>;
  POST?(request: Request, context: RouteContext): Response | Promise<Response>;
  PUT?(request: Request, context: RouteContext): Response | Promise<Response>;
  PATCH?(request: Request, context: RouteContext): Response | Promise<Response>;
  DELETE?(request: Request, context: RouteContext): Response | Promise<Response>;
};

/** The app routes that only exist with ee/; their files in app/ answer 404 without it. */
export type EeRouteKey =
  | "stripe/checkout" | "stripe/portal" | "stripe/webhook"
  | "billing" | "billing/discount-preview" | "billing/invoice"
  | "pricing" | "administration/pricing" | "administration/price-versions"
  | "superadmin/accounting-export" | "superadmin/bank-payments" | "superadmin/invoice-replacements"
  | "ai/evals" | "ai/chat" | "ai/conversations" | "ai/memory" | "ai/policy" | "ai/quote" | "ai/status"
  | "superadmin/ai-usage" | "integration-keys" | "mcp" | "v1" | "v1/tool";

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
  /** Whether HINTEK AI's control review can run and whether a model provider is configured (workspace overview). */
  aiOverview(): Promise<{ enabled: boolean; configured: boolean }>;
  paymentSandboxAvailable(): Promise<boolean>;
  /** Asks Stripe whether it accepts the configured secret key; null without ee/. */
  checkStripeSecretKey(): Promise<{ ok: boolean; message: string } | null>;
  /** The public landing page for a signed-out visitor, or a superadmin's preview. */
  landing(input: { superadmin: boolean; preview: boolean }): Promise<LandingDecision>;
};

export type NotifyFn = (message: string, isError?: boolean) => void;

export type ClientExtensions = {
  /** Fakturering och köp for a company admin; null without ee/. */
  BillingRead: ComponentType<{ endpoint?: string; sandboxQa?: boolean }> | null;
  /** Priser och erbjudanden under Produktadministration. */
  PricingAdministration: ComponentType<{ notify: NotifyFn }> | null;
  /** The landing page's inline editor. */
  LandingEditor: ComponentType | null;
  /** HINTEK AI: the assistant in the shell, the company's sharing choices, and the product owner's provider and usage views. */
  AssistantPanel: ComponentType<{ open: boolean; expanded: boolean; onOpenChange: (open: boolean) => void; onExpandedChange: (expanded: boolean) => void }> | null;
  SharingPolicyPanel: ComponentType | null;
  ProviderAdministration: ComponentType | null;
  AiUsageAdministration: ComponentType | null;
  /** API och MCP: keys, connections and the server's keys. */
  IntegrationKeys: ComponentType<{ notify: NotifyFn }> | null;
};
