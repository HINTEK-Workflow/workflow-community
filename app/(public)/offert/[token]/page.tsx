import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/kfid/errors";
import { readQuoteByToken } from "@/lib/quotes/customer-link-server";
import type { PublicQuotePage } from "@/lib/quotes/customer-link";
import { clientIp } from "@/lib/security/client-ip";
import { CustomerQuoteView } from "@/features/quotes/customer-quote";

export const dynamic = "force-dynamic";

// The address carries the link's token: never sent on as a referrer, never indexed.
export const metadata: Metadata = { title: "Offert", referrer: "no-referrer", robots: { index: false, follow: false } };

/**
 * Offert per e-post, steg E (2026-10-09): the customer opens the quote from the e-mail without an account and
 * accepts or declines it. The server reads the link (rate-limited per IP address) and hands the page only the
 * allow-listed customer view (lib/quotes/customer-link.ts publicQuoteView).
 */
export default async function CustomerQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const requestHeaders = await headers();
  let page: PublicQuotePage;
  let limited = false;
  try {
    page = await readQuoteByToken(token, { ip: clientIp(requestHeaders), userAgent: requestHeaders.get("user-agent") ?? "" });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 429) throw error;
    limited = true;
    page = { state: "invalid", message: error.message, company: "", label: "", quote: null, answer: null, method: null };
  }
  // A link that does not exist answers 404, not 200 with a text (MOB-21); a rate-limited visit keeps its message.
  if (page.state === "invalid" && !limited) notFound();
  return <CustomerQuoteView token={token} initial={page} />;
}
