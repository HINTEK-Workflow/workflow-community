import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, context, failure, requireCloudWriteAccess, requireModule, type Context } from "@/lib/kfid/server";
import { ApiError } from "@/lib/kfid/errors";
import { absoluteUrl } from "@/lib/env";
import { sendSystemEmail } from "@/lib/mail/mailer";
import { renderBaseTemplate } from "@/lib/mail/templates";
import { createInvoiceLink, revokeInvoiceLink } from "@/lib/customer-invoice/link-server";
import { mailConfig } from "@/lib/mail/settings-server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { workflowReportFont, workflowReportIdentity } from "@/lib/workflow/report-server";
import { createCustomerInvoicePdf } from "@/lib/customer-invoice/report";
import { INVOICE_LIST_FILTERS, INVOICE_LIST_SORTS, type InvoiceListFilter, type InvoiceView } from "@/lib/customer-invoice/model";
import { parseListSort } from "@/lib/list-filter";
import { logProforma, createStandaloneInvoice, invoiceOffer, correctCreditedInvoice, creditInvoice, getInvoice, invoiceBasisState, invoiceDocument, invoiceSettingsView, invoiceWayIn, issueInvoice, listInvoices, logInvoiceSent, markInvoicePaid, prepareInvoice, previewInvoiceContent, saveInvoiceSettings, type InvoiceCaller } from "@/lib/customer-invoice/server";

/**
 * Fakturor (owner's decision 2026-11-04). GET ?list=1 the company's list; ?id= one invoice; ?id=&format=pdf its document;
 * ?state=1 whether the company has invoicing at all (the list's way in); ?basis= the action on a basis; ?prepare= what is
 * needed to issue from a basis; ?settings=1 the setting. POST issue, preview (the document, nothing written), credit, correct,
 * paid, unpaid, send, settings, standalone (Ny faktura, a basis without a job) and proforma (the document or an e-mail, nothing locked). Session, company, membership and test-account restriction are in context(); Origin, Cloud
 * write access and the module on every change; the right Fakturera in the server functions on every call. While the setting is
 * off everything but the setting answers 404.
 */
const caller = (ctx: Context): InvoiceCaller => ({
  organizationId: ctx.organizationId, userId: ctx.user.id, userName: ctx.user.name || ctx.user.email || "", admin: ctx.admin, permissions: ctx.workflowPermissions, storageMode: ctx.organization.storageMode,
});
const noStore = { "Cache-Control": "private, no-store" };
const id = z.string().trim().min(1).max(100);
const attachment = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
const fileName = (kind: string, label: string) => `${kind === "CREDIT" ? "kreditfaktura" : "faktura"}-${label.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;

async function pdfBytes(ctx: Context, document: Parameters<typeof createCustomerInvoicePdf>[0]["content"], personalNumber: string, preview = false, proforma = false) {
  return new Uint8Array(await createCustomerInvoicePdf({ identity: await workflowReportIdentity(ctx.organizationId, ctx.organization.name), fontBytes: await workflowReportFont(), content: document, personalNumber, preview, proforma }));
}

export async function GET(request: Request) {
  try {
    const ctx = await context();
    const who = caller(ctx);
    const url = new URL(request.url);
    const params = url.searchParams;
    if (params.get("settings") === "1") return NextResponse.json(await invoiceSettingsView(who), { headers: noStore });
    if (params.get("state") === "1") return NextResponse.json(await invoiceWayIn(who), { headers: noStore });
    if (params.get("offer") === "1") return NextResponse.json(await invoiceOffer(who), { headers: noStore });
    if (params.has("basis")) return NextResponse.json(await invoiceBasisState(who, id.parse(params.get("basis"))), { headers: noStore });
    if (params.has("prepare")) return NextResponse.json(await prepareInvoice(who, id.parse(params.get("prepare"))), { headers: noStore });
    if (params.has("id")) {
      const one = id.parse(params.get("id"));
      if (params.get("format") === "pdf") {
        const document = await invoiceDocument(who, one);
        return new Response(await pdfBytes(ctx, document.content, document.personalNumber), { headers: { "Content-Type": "application/pdf", "Content-Disposition": attachment(fileName(document.content.kind, document.content.label)), ...noStore } });
      }
      return NextResponse.json({ invoice: await getInvoice(who, one) }, { headers: noStore });
    }
    const raw = params.get("status");
    const filter: InvoiceListFilter = (INVOICE_LIST_FILTERS as readonly string[]).includes(raw ?? "") ? raw as InvoiceListFilter : "all";
    return NextResponse.json(await listInvoices(who, { filter, page: Number.parseInt(params.get("page") ?? "1", 10) || 1, q: (params.get("q") ?? "").trim().slice(0, 100), counts: params.get("counts") === "1", sort: parseListSort(params.get("sort"), INVOICE_LIST_SORTS) }), { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("issue"), basisId: id, revision: z.number().int().min(1), details: z.unknown() }),
  z.object({ action: z.literal("preview"), basisId: id, details: z.unknown() }),
  z.object({ action: z.literal("credit"), id, reason: z.string().trim().min(1, "Skriv varför fakturan krediteras.").max(300) }),
  z.object({ action: z.literal("correct"), id }),
  z.object({ action: z.literal("paid"), id, paidOn: z.string().trim().max(10) }),
  z.object({ action: z.literal("unpaid"), id }),
  z.object({ action: z.literal("send"), id, email: z.email("Skriv en e-postadress.").max(200), message: z.string().trim().max(1000).default("") }),
  z.object({ action: z.literal("settings"), settings: z.unknown() }),
  z.object({ action: z.literal("standalone"), invoice: z.unknown() }),
  z.object({ action: z.literal("proforma"), basisId: id, details: z.unknown(), email: z.union([z.literal(""), z.email("Skriv en giltig e-postadress.").max(200)]).default(""), message: z.string().trim().max(1000).default("") }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const who = caller(ctx);
    const input = requestSchema.parse(await body(request));
    requireModule(ctx, "invoicing");
    if (input.action === "preview") {
      const document = await previewInvoiceContent(who, input.basisId, input.details);
      return new Response(await pdfBytes(ctx, document.content, document.personalNumber, true), { headers: { "Content-Type": "application/pdf", "Content-Disposition": attachment("faktura-forhandsgranskning.pdf"), ...noStore } });
    }
    await requireCloudWriteAccess(ctx);
    switch (input.action) {
      case "settings": return NextResponse.json(await saveInvoiceSettings(who, input.settings));
      case "standalone": return NextResponse.json(await createStandaloneInvoice(who, input.invoice));
      case "proforma": return await proforma(ctx, who, input.basisId, input.details, input.email, input.message);
      case "issue": return NextResponse.json(await issueInvoice(who, input.basisId, input.revision, input.details));
      case "credit": return NextResponse.json(await creditInvoice(who, input.id, input.reason));
      case "correct": return NextResponse.json(await correctCreditedInvoice(who, input.id));
      case "paid": await markInvoicePaid(who, input.id, input.paidOn); return NextResponse.json({ ok: true });
      case "unpaid": await markInvoicePaid(who, input.id, null); return NextResponse.json({ ok: true });
      case "send": return NextResponse.json(await sendInvoice(ctx, who, input.id, input.email, input.message));
    }
  } catch (error) {
    return failure(error);
  }
}

async function sendInvoiceLink(ctx: Context, who: InvoiceCaller, view: InvoiceView, email: string, message: string, blockedReason: string | null | undefined) {
  const link = await createInvoiceLink({ organizationId: ctx.organizationId, invoiceId: view.id, email, sentById: ctx.user.id });
  const url = absoluteUrl(link.path);
  if (blockedReason) return { ok: true, email, notice: blockedReason, testUrl: url };
  const word = view.kind === "CREDIT" ? "Kreditfaktura" : "Faktura";
  const { seller, dueOn, title } = view.content;
  const mail = renderBaseTemplate({
    heading: `${word} från ${seller.name}`,
    intro: `${word} ${view.label} gäller ${title}.`,
    outro: [...(dueOn ? [`Förfallodatum ${dueOn}.`] : []), ...(message ? [message] : []), "Öppna länken för att se fakturan och ladda ner den som PDF."].join(" "),
    actionLabel: "Visa fakturan", actionUrl: url,
    expiresText: `Länken gäller till och med ${link.validUntil}. Den är personlig, så skicka inte vidare e-postmeddelandet.`,
  });
  try {
    await sendSystemEmail({ to: email, subject: `${word} ${view.label} från ${seller.name}`.replace(/[\r\n]+/g, " ").slice(0, 200), ...mail, ...(ctx.user.email ? { headers: { "Reply-To": ctx.user.email } } : {}) });
  } catch {
    await revokeInvoiceLink(link.id);
    throw new ApiError(502, "E-posten gick inte iväg. Försök igen.");
  }
  await logInvoiceSent(who, view.id, view.label, email);
  return { ok: true, email };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
function invoiceMail(heading: string, paragraphs: readonly string[]) {
  return {
    html: `<div style="font-family:'Segoe UI',Arial,sans-serif;color:#172033;font-size:15px;line-height:1.6;"><h1 style="font-size:22px;margin:0 0 12px;">${escapeHtml(heading)}</h1>${paragraphs.map((text) => `<p style="margin:0 0 12px;">${escapeHtml(text)}</p>`).join("")}</div>`,
    text: [heading, ...paragraphs].join("\n\n"),
  };
}

/**
 * Proformafaktura (2026-11-05): downloaded, or sent as an attachment through the same limits as an invoice. It never holds an
 * identity number, so it can always go by e-mail. Only what really happened is written in the audit log.
 */
async function proforma(ctx: Context, who: InvoiceCaller, basisId: string, details: unknown, email: string, message: string) {
  const { content } = await previewInvoiceContent(who, basisId, details);
  const bytes = await pdfBytes(ctx, content, "", false, true);
  const name = `proforma-${content.basisLabel.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
  if (!email) {
    await logProforma(who, content, "");
    return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": attachment(name), ...noStore } });
  }
  if (!(await hitRateLimit(RATE_RULES.quoteSendOrganization, `invoice:${ctx.organizationId}`)).allowed) throw new ApiError(429, "Företaget har skickat många fakturor den senaste timmen. Vänta en stund.");
  const { blockedReason } = await mailConfig();
  if (blockedReason) return NextResponse.json({ ok: true, email, notice: blockedReason });
  const mail = invoiceMail(`Proformafaktura från ${content.seller.name}`, [`Proformafakturan är bifogad som PDF: ${content.title}.`, "Beloppet kan användas för en inköpsorder. Det här är inte en faktura och inget betalningskrav.", ...(message ? [message] : [])]);
  try {
    await sendSystemEmail({
      to: email, subject: `Proformafaktura från ${content.seller.name}`.replace(/[\r\n]+/g, " ").slice(0, 200), ...mail,
      attachments: [{ filename: name, content: Buffer.from(bytes), contentType: "application/pdf" }],
      ...(ctx.user.email ? { headers: { "Reply-To": ctx.user.email } } : {}),
    });
  } catch {
    throw new ApiError(502, "E-posten gick inte iväg. Försök igen.");
  }
  await logProforma(who, content, email);
  return NextResponse.json({ ok: true, email });
}

/**
 * Skicka: an ordinary invoice as an attachment, one with a personal number as a link (below), through the same system e-mail and limits as a quote, the reply going to the person who
 * sent it. On a loopback test instance nothing is sent and the page is told so, as with a quote; only a real send is logged.
 */
async function sendInvoice(ctx: Context, who: InvoiceCaller, invoiceId: string, email: string, message: string) {
  const view = await getInvoice(who, invoiceId);
  if (!view.canEdit) throw new ApiError(403, "Du saknar rätten Fakturera.");
  if (!(await hitRateLimit(RATE_RULES.quoteSendOrganization, `invoice:${ctx.organizationId}`)).allowed) throw new ApiError(429, "Företaget har skickat många fakturor den senaste timmen. Vänta en stund.");
  if (!(await hitRateLimit(RATE_RULES.quoteSendQuote, `invoice:${ctx.organizationId}:${invoiceId}`)).allowed) throw new ApiError(429, "Fakturan har skickats flera gånger nyss. Vänta en stund innan du skickar igen.");
  const { blockedReason } = await mailConfig();
  // A personal number stays out of mailboxes: the e-mail holds a link to a secure page, as a quote's does.
  if (view.identityMasked) return sendInvoiceLink(ctx, who, view, email, message, blockedReason);
  if (blockedReason) return { ok: true, email, notice: blockedReason };
  const document = await invoiceDocument(who, invoiceId);
  const bytes = await pdfBytes(ctx, document.content, document.personalNumber);
  const { content } = document;
  const word = content.kind === "CREDIT" ? "Kreditfaktura" : "Faktura";
  const mail = invoiceMail(`${word} från ${content.seller.name}`, [`${word} ${content.label} är bifogad som PDF: ${content.title}.`, ...(content.dueOn ? [`Förfallodatum ${content.dueOn}.`] : []), ...(message ? [message] : [])]);
  try {
    await sendSystemEmail({
      to: email, subject: `${word} ${content.label} från ${content.seller.name}`.replace(/[\r\n]+/g, " ").slice(0, 200), ...mail,
      attachments: [{ filename: fileName(content.kind, content.label), content: Buffer.from(bytes), contentType: "application/pdf" }],
      ...(ctx.user.email ? { headers: { "Reply-To": ctx.user.email } } : {}),
    });
  } catch {
    throw new ApiError(502, "E-posten gick inte iväg. Försök igen.");
  }
  await logInvoiceSent(who, invoiceId, content.label, email);
  return { ok: true, email };
}
