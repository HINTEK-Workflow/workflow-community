// The core without ee/ (Fas 2, 2026-09-30): no payment, unlimited use, no landing page, AI model off.
import type { ServerExtensions } from "@/lib/extensions/types";

export const serverExtensions: ServerExtensions = {
  routes: {},
  // Without billing nothing is billing-managed, so writing is always available (as for an unpaid-free company today).
  cloudWriteAccess: async () => ({
    allowed: true, billingManaged: false, hasActiveEntitlement: false, hasPaymentGrace: false, blockingInvoiceIds: [], reason: "AVAILABLE",
  }),
  syncCloudSeats: async () => undefined,
  syncCreditExpiryNotices: async () => undefined,
  aiProviderStatus: async () => null,
  assistantProvider: async () => null,
  paymentSandboxAvailable: async () => false,
  checkStripeSecretKey: async () => null,
  landing: async () => ({ kind: "hidden" }),
};
