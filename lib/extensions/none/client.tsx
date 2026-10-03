"use client";
// The core without ee/ (Fas 2; since 2026-10-03 with every function): no payment views and no landing page editor.
import { coreClientExtensions } from "@/lib/extensions/core-client";
import type { ClientExtensions } from "@/lib/extensions/types";

export const clientExtensions: ClientExtensions = {
  BillingRead: null,
  PricingAdministration: null,
  LandingEditor: null,
  ...coreClientExtensions,
};
