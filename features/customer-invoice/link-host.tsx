"use client";

import { clientExtensions } from "@ee/client";
import type { PublicInvoicePage } from "@/lib/customer-invoice/model";

/** The customer's invoice page, loaded on first use (lib/extensions/core-client.tsx). */
export function CustomerInvoiceLinkHost({ token, initial }: { token: string; initial: PublicInvoicePage }) {
  const { CustomerInvoiceLinkView } = clientExtensions;
  return CustomerInvoiceLinkView ? <CustomerInvoiceLinkView token={token} initial={initial} /> : null;
}
