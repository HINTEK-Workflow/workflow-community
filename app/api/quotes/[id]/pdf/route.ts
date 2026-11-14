import { z } from "zod";
import { context, failure } from "@/lib/kfid/server";
import { getQuote } from "@/lib/quotes/server";
import { createQuotePdf } from "@/lib/quotes/quote-report";
import { workflowReportFont, workflowReportIdentity } from "@/lib/workflow/report-server";
import { recordFeature } from "@/lib/analytics/record";

export const dynamic = "force-dynamic";

/**
 * Offertens PDF (2026-10-09, steg B): the quote as the customer gets it, drawn with the report kit in the
 * company's report colours with its logo and the shared footer. Offerter – läsa; inside the caller's company only.
 * Selling prices only: the purchase price and the markup are never printed. ?inline=1 opens it in the browser.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context();
    const { id } = await params;
    const quote = await getQuote({ organizationId: ctx.organizationId, userId: ctx.user.id, admin: ctx.admin, permissions: ctx.workflowPermissions, storageMode: ctx.organization.storageMode }, z.string().trim().min(1).max(100).parse(id));
    recordFeature("report_pdf");
    const identity = await workflowReportIdentity(ctx.organizationId, ctx.organization.name);
    const bytes = await createQuotePdf({ identity, fontBytes: await workflowReportFont(), quote });
    const name = `offert-${quote.label.replace(/\s+/g, "-")}-${quote.title}`.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").slice(0, 120);
    const disposition = new URL(request.url).searchParams.get("inline") === "1" ? "inline" : "attachment";
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(`${name}.pdf`)}`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
