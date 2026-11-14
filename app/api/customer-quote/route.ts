import { NextResponse } from "next/server";
import { body, checkOrigin, failure } from "@/lib/kfid/server";
import { answerQuoteByToken } from "@/lib/quotes/customer-link-server";
import { clientIp } from "@/lib/security/client-ip";

export const dynamic = "force-dynamic";

/**
 * Offert per e-post, steg E (2026-10-09): the customer's answer from the quote page (/offert/<token>), without an
 * account. The token is the only key: it resolves to one link of one quote of one company. Origin is checked like every
 * other mutation; the answer is rate-limited per IP address and per link (lib/quotes/customer-link-server.ts). The reply
 * is the page's allow-listed customer view – never purchase prices, markup or internal fields.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const page = await answerQuoteByToken(await body(request), { ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") ?? "" });
    return NextResponse.json({ page }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    return failure(error);
  }
}
