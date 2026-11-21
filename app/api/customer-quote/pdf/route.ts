import { z } from "zod";
import { body, checkOrigin, failure } from "@/lib/kfid/server";
import { isQuoteLinkToken } from "@/lib/quotes/customer-link";
import { quotePdfByToken } from "@/lib/quotes/customer-link-server";
import { clientIp } from "@/lib/security/client-ip";
import { recordFeature } from "@/lib/analytics/record";

export const dynamic = "force-dynamic";

/**
 * "Ladda ner som PDF" on the customer's quote page (plan 1D, 2026-10-11): the same PDF the company sends, built
 * from the version the link was sent for and the customer snapshot taken then. The token is the only key and is sent in
 * the body (never in the address); Origin is checked like every other mutation, the read is rate-limited per IP address
 * and every download is logged for the company (lib/quotes/customer-link-server.ts). Selling prices only.
 */
const requestSchema = z.object({ token: z.string().refine(isQuoteLinkToken, "Länken fungerar inte.") });

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = requestSchema.parse(await body(request));
    const { bytes, fileName } = await quotePdfByToken(input.token, { ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") ?? "" });
    recordFeature("report_pdf", { cookie: request.headers.get("cookie") });
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    } });
  } catch (error) {
    return failure(error);
  }
}
