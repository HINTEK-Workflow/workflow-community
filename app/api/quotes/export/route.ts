import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, context, failure, requireCloudWriteAccess, requireModule, type Context } from "@/lib/kfid/server";
import { ApiError } from "@/lib/kfid/errors";
import { todayInSweden } from "@/lib/catalogue/snapshot";
import { QUOTE_SIE_REFUSED, quotesCsv } from "@/lib/quotes/accounting";
import { fortnoxInvoicePayload } from "@/lib/quotes/fortnox";
import { createFortnoxInvoice } from "@/lib/quotes/fortnox-client";
import { requireQuotes, type QuoteCaller } from "@/lib/quotes/server";
import {
  accountingQuotes, customerAccountingNumber, EXPORT_MAX_QUOTES, externalSendBlocked, fortnoxKeyName, openFortnoxKey, readAccountingSettings, recordAccountingEvent, rememberCustomerAccountingNumber, writeAccountingSettings,
} from "@/lib/quotes/accounting-server";

export const dynamic = "force-dynamic";

/**
 * Export av offert/fakturaunderlag (2026-10-09, steg D).
 * GET ?format=csv&ids=a,b – the quotes' lines as CSV; ?part=accounting – the company's account mapping and whether a Fortnox key is saved (its name only).
 * POST settings (company admin), fortnox_preview ("Visa vad som skickas", nothing leaves Workflow) and fortnox_send
 * (Offerter – redigera; only with the company's own Fortnox key). Session, company, membership, the right and Origin
 * on every POST are checked; context() also stops anyone outside the private test.
 * Ingen SIE för offerter (2026-11-01): a quote is no sale, so ?format=sie is refused with a plain message; only an
 * invoiced fakturaunderlag goes to the accounting (app/api/invoice-bases/export).
 */
const caller = (ctx: Context): QuoteCaller => ({ organizationId: ctx.organizationId, userId: ctx.user.id, admin: ctx.admin, permissions: ctx.workflowPermissions, storageMode: ctx.organization.storageMode });
const noStore = { "Cache-Control": "private, no-store" };
const id = z.string().trim().min(1).max(100);
const idList = z.string().max(EXPORT_MAX_QUOTES * 101).transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean)).pipe(z.array(id).min(1, "Välj minst en offert.").max(EXPORT_MAX_QUOTES, `Högst ${EXPORT_MAX_QUOTES} offerter åt gången.`));
const fileName = (base: string, ext: string) => `${base.replace(/[<>:"/\\|?*\u0000-\u001f\s]+/g, "-").slice(0, 100)}.${ext}`;
const attachment = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;

export async function GET(request: Request) {
  try {
    const ctx = await context();
    const who = caller(ctx);
    requireQuotes(who, "read");
    const url = new URL(request.url);
    if (url.searchParams.get("part") === "accounting") {
      return NextResponse.json({ settings: await readAccountingSettings(ctx.organizationId), canEdit: ctx.admin, fortnoxKey: await fortnoxKeyName(ctx.organizationId) }, { headers: noStore });
    }
    if (url.searchParams.get("format") === "sie") throw new ApiError(422, QUOTE_SIE_REFUSED);
    z.literal("csv").parse(url.searchParams.get("format"));
    const ids = idList.parse(url.searchParams.get("ids") ?? "");
    const quotes = await accountingQuotes(who, ids);
    if (!quotes.length) throw new ApiError(404, "Offerten hittades inte.");
    const today = todayInSweden();
    const base = quotes.length === 1 ? `offert-${quotes[0].label}` : `offerter-${today}`;
    return new Response(quotesCsv(quotes), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": attachment(fileName(base, "csv")), ...noStore } });
  } catch (error) {
    return failure(error);
  }
}

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), settings: z.unknown() }),
  z.object({ action: z.literal("fortnox_preview"), id, customerNumber: z.string().max(100) }),
  z.object({ action: z.literal("fortnox_send"), id, customerNumber: z.string().max(100) }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const who = caller(ctx);
    const input = requestSchema.parse(await body(request));
    if (input.action === "settings") {
      requireQuotes(who, "read");
      await requireCloudWriteAccess(ctx);
      return NextResponse.json({ settings: await writeAccountingSettings(who, input.settings) });
    }
    // The preview reads; sending is a new action. The accounts above are shared with the invoice bases.
    if (input.action === "fortnox_send") requireModule(ctx, "quotes");
    requireQuotes(who, input.action === "fortnox_send" ? "edit" : "read");
    const [quote] = await accountingQuotes(who, [input.id]);
    if (!quote) throw new ApiError(404, "Offerten hittades inte.");
    // Kundnummer i bokföringen (plan 1L): filled in from the customer; a number sent is kept on the customer afterwards.
    const stored = await customerAccountingNumber(ctx.organizationId, quote.customerId);
    const customerNumber = input.customerNumber.trim() || stored;
    const built = fortnoxInvoicePayload(quote, await readAccountingSettings(ctx.organizationId), customerNumber);
    if (input.action === "fortnox_preview") {
      return NextResponse.json({ payload: built.payload, issues: built.issues, keyName: await fortnoxKeyName(ctx.organizationId), blocked: externalSendBlocked(), customerNumber: stored }, { headers: noStore });
    }
    if (built.issues.length || !built.payload) throw new ApiError(422, built.issues.join(" "));
    const blocked = externalSendBlocked();
    if (blocked) throw new ApiError(409, blocked);
    const token = await openFortnoxKey(ctx.organizationId);
    const result = await createFortnoxInvoice(token, built.payload);
    await recordAccountingEvent(ctx.organizationId, ctx.user.id, `Skickade offert ${quote.label} till Fortnox som fakturaunderlag${result.documentNumber ? ` (nr ${result.documentNumber})` : ""}.`);
    await rememberCustomerAccountingNumber(ctx.organizationId, quote.customerId, customerNumber);
    return NextResponse.json({ ok: true, documentNumber: result.documentNumber });
  } catch (error) {
    return failure(error);
  }
}
