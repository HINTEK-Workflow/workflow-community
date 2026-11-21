import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/kfid/errors";
import { clientIp } from "@/lib/security/client-ip";
import { readInvoiceLink } from "@/lib/customer-invoice/link-server";
import type { PublicInvoicePage } from "@/lib/customer-invoice/model";
import { CustomerInvoiceLinkHost } from "@/features/customer-invoice/link-host";

export const dynamic = "force-dynamic";

// The address carries the link's token: never sent on as a referrer, never indexed.
export const metadata: Metadata = { title: "Faktura", referrer: "no-referrer", robots: { index: false, follow: false } };

/**
 * The customer's page for an invoice with a personal number (2026-11-04), without an account. The server reads the link
 * (lib/customer-invoice/link-server.ts), rate-limited per IP address, and hands the page only the allow-listed view.
 */
export default async function CustomerInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const requestHeaders = await headers();
  let page: PublicInvoicePage | null;
  try {
    page = await readInvoiceLink(token, { ip: clientIp(requestHeaders) });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 429) throw error;
    page = { state: "limited", invoice: null, company: "" };
  }
  if (!page) notFound();
  return <CustomerInvoiceLinkHost token={token} initial={page} />;
}
