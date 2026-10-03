// The core without ee/ (Fas 2, 2026-09-30; 2026-10-03: Workflow AI, API and MCP are in the core): no payment, unlimited
// use and no landing page.
import type { ServerExtensions } from "@/lib/extensions/types";
import { coreAiOverview, coreOauthAuthorize } from "@/lib/extensions/core-routes";

export const serverExtensions: ServerExtensions = {
  routes: {},
  // Without billing nothing is billing-managed, so writing is always available (as for an unpaid-free company today).
  cloudWriteAccess: async () => ({
    allowed: true, billingManaged: false, hasActiveEntitlement: false, hasPaymentGrace: false, blockingInvoiceIds: [], reason: "AVAILABLE",
  }),
  syncCloudSeats: async () => undefined,
  syncCreditExpiryNotices: async () => undefined,
  aiOverview: coreAiOverview,
  paymentSandboxAvailable: async () => false,
  checkStripeSecretKey: async () => null,
  legalDocument: async () => null,
  landing: async () => ({ kind: "hidden" }),
  oauthAuthorize: coreOauthAuthorize,
};
