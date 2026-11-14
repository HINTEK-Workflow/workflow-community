import { z } from "zod";
import { body, checkOrigin, failure } from "@/lib/kfid/server";
import { isQuoteLinkToken } from "@/lib/quotes/customer-link";
import { clientIp } from "@/lib/security/client-ip";
import { invoiceLinkPdf } from "@/lib/customer-invoice/link-server";

/**
 * "Ladda ner som PDF" on the customer's invoice page, without an account. The token is the only key and is sent in the body, never
 * in the address; Origin is checked like every other mutation, the read is rate-limited per IP address and every download is logged.
 */
const requestSchema = z.object({ token: z.string().refine(isQuoteLinkToken, "Länken fungerar inte.") });

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = requestSchema.parse(await body(request));
    const { bytes, fileName } = await invoiceLinkPdf(input.token, { ip: clientIp(request.headers) });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    return failure(error);
  }
}
