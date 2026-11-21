import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, context, failure, requireCloudWriteAccess, requireModule, type Context } from "@/lib/kfid/server";
import { ApiError } from "@/lib/kfid/errors";
import { todayInSweden } from "@/lib/catalogue/snapshot";
import { currentAppVersion } from "@/lib/release-notes";
import { quotesCsv, quotesSie, sieBytes, sieRefusal } from "@/lib/quotes/accounting";
import { fortnoxInvoicePayload } from "@/lib/quotes/fortnox";
import { createFortnoxInvoice } from "@/lib/quotes/fortnox-client";
import { companyMeta, customerAccountingNumber, externalSendBlocked, fortnoxKeyName, openFortnoxKey, readAccountingSettings, recordAccountingEvent, rememberCustomerAccountingNumber } from "@/lib/quotes/accounting-server";
import { accountingInvoiceBasis, getInvoiceBasis, markInvoiceBasisInvoiced, requireInvoiceBasis, type InvoiceBasisCaller } from "@/lib/invoice-basis/server";
import { createInvoiceBasisPdf } from "@/lib/invoice-basis/basis-report";
import { workflowReportFont, workflowReportIdentity } from "@/lib/workflow/report-server";

export const dynamic = "force-dynamic";

/**
 * Export av fakturaunderlag från utfört arbete (2026-10-10), the same way out as a quote (app/api/quotes/export):
 * GET ?format=pdf&id= – the basis as a document; ?format=csv&id= – the lines as CSV; ?format=sie&id= – a SIE 4 import file with one verification, dated the day it
 * was invoiced, with the company's own accounts; only for a basis marked as invoiced (2026-11-01: a draft is
 * refused with a plain message, so a basis is never booked before it is approved). POST fortnox_preview ("Visa vad som skickas") and
 * fortnox_send (Offerter – redigera, the company's own key); a basis that reaches Fortnox is marked as invoiced. CSV and
 * SIE never mark anything. Session, company, the rights on the basis and its job or project, and Origin on every POST.
 */
const caller = (ctx: Context): InvoiceBasisCaller => ({
  organizationId: ctx.organizationId, userId: ctx.user.id, userName: ctx.user.name || ctx.user.email || "", admin: ctx.admin, permissions: ctx.workflowPermissions, storageMode: ctx.organization.storageMode,
});
const noStore = { "Cache-Control": "private, no-store" };
const id = z.string().trim().min(1).max(100);
const fileName = (base: string, ext: string) => `${base.replace(/[<>:"/\\|?*\u0000-\u001f\s]+/g, "-").slice(0, 100)}.${ext}`;
const attachment = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;

export async function GET(request: Request) {
  try {
    const ctx = await context();
    const who = caller(ctx);
    const url = new URL(request.url);
    const format = z.enum(["csv", "sie", "pdf"]).parse(url.searchParams.get("format"));
    const basis = await accountingInvoiceBasis(who, id.parse(url.searchParams.get("id")));
    const base = `fakturaunderlag-${basis.label}`;
    // The basis as a document (2026-11-01): selling prices only, and it says that it is no invoice.
    if (format === "pdf") {
      const view = await getInvoiceBasis(who, basis.id);
      const bytes = await createInvoiceBasisPdf({ identity: await workflowReportIdentity(ctx.organizationId, ctx.organization.name), fontBytes: await workflowReportFont(), basis: view });
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": attachment(fileName(base, "pdf")), ...noStore } });
    }
    if (format === "csv") {
      return new Response(quotesCsv([basis]), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": attachment(fileName(base, "csv")), ...noStore } });
    }
    const refusal = sieRefusal(basis);
    if (refusal) throw new ApiError(409, refusal);
    const meta = await companyMeta(ctx.organizationId, ctx.organization.name);
    const sie = quotesSie([basis], await readAccountingSettings(ctx.organizationId), { ...meta, generatedOn: todayInSweden(), programVersion: currentAppVersion() });
    if (sie.issues.length) throw new ApiError(422, sie.issues.slice(0, 6).join(" "));
    return new Response(new Uint8Array(sieBytes(sie.text)), { headers: { "Content-Type": "text/plain; charset=IBM437", "Content-Disposition": attachment(fileName(base, "si")), ...noStore } });
  } catch (error) {
    return failure(error);
  }
}

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("fortnox_preview"), id, customerNumber: z.string().max(100) }),
  z.object({ action: z.literal("fortnox_send"), id, customerNumber: z.string().max(100) }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const who = caller(ctx);
    const input = requestSchema.parse(await body(request));
    // The preview reads; sending is a new action.
    if (input.action === "fortnox_send") requireModule(ctx, "invoicing");
    requireInvoiceBasis(who, input.action === "fortnox_send" ? "edit" : "read");
    const basis = await accountingInvoiceBasis(who, input.id);
    // Kundnummer i bokföringen (plan 1L): filled in from the basis's customer; a number sent is kept on the customer afterwards.
    const customerId = (await getInvoiceBasis(who, input.id)).customer?.id ?? null;
    const stored = await customerAccountingNumber(ctx.organizationId, customerId);
    const customerNumber = input.customerNumber.trim() || stored;
    const built = fortnoxInvoicePayload(basis, await readAccountingSettings(ctx.organizationId), customerNumber);
    if (input.action === "fortnox_preview") {
      return NextResponse.json({ payload: built.payload, issues: built.issues, keyName: await fortnoxKeyName(ctx.organizationId), blocked: externalSendBlocked(), customerNumber: stored }, { headers: noStore });
    }
    await requireCloudWriteAccess(ctx);
    // Redan fakturerat: an invoiced basis is never sent again.
    if (basis.status === "INVOICED") throw new ApiError(409, "Underlaget är redan fakturerat och skickas inte igen.");
    if (built.issues.length || !built.payload) throw new ApiError(422, built.issues.join(" "));
    const blocked = externalSendBlocked();
    if (blocked) throw new ApiError(409, blocked);
    const token = await openFortnoxKey(ctx.organizationId);
    const result = await createFortnoxInvoice(token, built.payload);
    await recordAccountingEvent(ctx.organizationId, ctx.user.id, `Skickade fakturaunderlag ${basis.label} till Fortnox${result.documentNumber ? ` (nr ${result.documentNumber})` : ""}.`);
    await rememberCustomerAccountingNumber(ctx.organizationId, customerId, customerNumber);
    // In Fortnox now: the basis is marked as invoiced.
    await markInvoiceBasisInvoiced(who, basis.id, null);
    return NextResponse.json({ ok: true, documentNumber: result.documentNumber, invoiced: true });
  } catch (error) {
    return failure(error);
  }
}
