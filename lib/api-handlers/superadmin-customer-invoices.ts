import { NextResponse } from "next/server";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { workflowReportFont, workflowReportIdentity } from "@/lib/workflow/report-server";
import { createCustomerInvoicePdf } from "@/lib/customer-invoice/report";
import { discloseInvoice, invoiceDisclosureCandidates, invoiceDisclosureSchema } from "@/lib/customer-invoice/disclosure";

/**
 * Fakturor på begäran: an erased or switched-off company's kept invoices, as Personalliggare på begäran. Superadmin only. GET lists
 * the inactive companies with kept invoices (counts and dates); POST (Origin, required reason) returns one invoice's PDF.
 */
async function superadmin() {
  const ctx = await context();
  if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
  return ctx;
}

export async function GET() {
  try {
    await superadmin();
    return NextResponse.json({ companies: await invoiceDisclosureCandidates() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const input = invoiceDisclosureSchema.parse(await body(request));
    const { content, personalNumber } = await discloseInvoice(input, ctx.user.id);
    const bytes = await createCustomerInvoicePdf({ identity: await workflowReportIdentity(input.organizationId, content.seller.name), fontBytes: await workflowReportFont(), content, personalNumber });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`faktura-${content.label.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`)}`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
