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
  // Without billing no company is ever billing-managed, so nothing is ever erased automatically after an ended agreement.
  cloudAgreementState: async () => ({ state: "NOT_BILLING" }),
  hasPayments: false,
  companyPayments: async () => ({}),
  syncCloudSeats: async () => undefined,
  cloudTierNotice: async () => null,
  syncCreditExpiryNotices: async () => undefined,
  aiOverview: coreAiOverview,
  aiCreditValueOre: async () => null,
  paymentSandboxAvailable: async () => false,
  checkStripeSecretKey: async () => null,
  legalDocument: async () => null,
  landing: async () => ({ kind: "hidden" }),
  oauthAuthorize: coreOauthAuthorize,
};
