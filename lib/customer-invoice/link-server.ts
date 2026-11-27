import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { todayInSweden } from "@/lib/catalogue/snapshot";
import { createQuoteLinkToken, hashQuoteLinkToken } from "@/lib/quotes/customer-link-token";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { openValue } from "@/lib/security/key-ring";
import { addDays, INVOICE_LINK_DAYS, invoiceContentOf, invoiceLinkPath, invoiceLinkState, publicInvoiceView, type InvoiceContent, type PublicInvoicePage } from "@/lib/customer-invoice/model";
import { workflowReportFont, workflowReportIdentity } from "@/lib/workflow/report-server";
import { createCustomerInvoicePdf } from "@/lib/customer-invoice/report";

/**
 * The secure page for an invoice with a personal number (owner's decision 2026-11-04): a ROT invoice is never attached to an
 * e-mail. The same mechanism as a quote's customer link (lib/quotes/customer-link-server.ts): 32 random bytes, only the sha256 is
 * stored, a token resolves to exactly one link of one invoice of one company, a new link replaces the earlier ones, an expiry, a
 * rate limit per IP address, never indexed and never sent on as a referrer. It answers only while the company is active and has
 * invoicing on. The page shows no personal number; the PDF it hands out does, as the invoice must, and each download is logged.
 */
type LinkRow = { id: string; organizationId: string; invoiceId: string; validUntil: string; revokedAt: Date | null; openedAt: Date | null; label: string; content: unknown; identitySealed: string | null; credited: boolean };

async function loadLink(token: unknown): Promise<LinkRow | null> {
  const hash = hashQuoteLinkToken(token);
  if (!hash) return null;
  const [row] = await prisma.$queryRaw<LinkRow[]>`SELECT l."id", l."organizationId", l."invoiceId", l."validUntil", l."revokedAt", l."openedAt", i."label", i."content", i."identitySealed", EXISTS (SELECT 1 FROM "CustomerInvoice" c WHERE c."creditOfId" = i."id") AS "credited"
    FROM "CustomerInvoiceLink" l
    JOIN "CustomerInvoice" i ON i."id" = l."invoiceId" AND i."organizationId" = l."organizationId"
    JOIN "Organization" o ON o."id" = l."organizationId" AND o."isActive" = TRUE
    JOIN "CustomerInvoiceSeries" s ON s."organizationId" = l."organizationId" AND s."enabled" = TRUE
    WHERE l."tokenHash" = ${hash}`;
  return row ?? null;
}

/** A new link for the invoice: the earlier ones stop working. Returns the token, which exists only in the e-mail. */
export async function createInvoiceLink(input: { organizationId: string; invoiceId: string; email: string; sentById: string; today?: string }, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<{ id: string; token: string; path: string; validUntil: string }> {
  const token = createQuoteLinkToken();
  const validUntil = addDays(input.today ?? todayInSweden(), INVOICE_LINK_DAYS);
  const id = randomUUID();
  await db.$executeRaw`UPDATE "CustomerInvoiceLink" SET "revokedAt" = NOW() WHERE "organizationId" = ${input.organizationId} AND "invoiceId" = ${input.invoiceId} AND "revokedAt" IS NULL`;
  await db.$executeRaw`INSERT INTO "CustomerInvoiceLink" ("id", "organizationId", "invoiceId", "tokenHash", "email", "validUntil", "sentById") VALUES (${id}, ${input.organizationId}, ${input.invoiceId}, ${hashQuoteLinkToken(token)}, ${input.email}, ${validUntil}, ${input.sentById})`;
  return { id, token, path: invoiceLinkPath(token), validUntil };
}
export const revokeInvoiceLink = (id: string) => prisma.$executeRaw`UPDATE "CustomerInvoiceLink" SET "revokedAt" = NOW() WHERE "id" = ${id}`;

const logLink = async (row: LinkRow, action: string, detail: string) => {
  await prisma.$executeRaw`INSERT INTO "CustomerInvoiceEvent" ("id", "organizationId", "invoiceId", "action", "detail", "actorName") VALUES (${randomUUID()}, ${row.organizationId}, ${row.invoiceId}, ${action}, ${detail}, 'Kunden')`;
};
async function allowed(ip: string) {
  if (!(await hitRateLimit(RATE_RULES.invoiceLinkRead, ip)).allowed) throw new ApiError(429, "För många försök. Vänta en stund och försök igen.");
}

/** The page behind the link; null when the link does not exist (the page answers 404). */
export async function readInvoiceLink(token: unknown, meta: { ip: string }, today = todayInSweden()): Promise<PublicInvoicePage | null> {
  await allowed(meta.ip);
  const row = await loadLink(token);
  const content = row ? invoiceContentOf(row.content) : null;
  if (!row || !content) return null;
  const state = invoiceLinkState(row, today);
  if (state === "open" && !row.openedAt) {
    await prisma.$executeRaw`UPDATE "CustomerInvoiceLink" SET "openedAt" = NOW() WHERE "id" = ${row.id} AND "openedAt" IS NULL`;
    await logLink(row, "opened", "Kunden öppnade länken.");
  }
  return { state, invoice: state === "open" ? publicInvoiceView(content, row.credited) : null, company: content.seller.name };
}

/** The document, while the link is open. The number is opened for this document only; the log and the audit text never hold it. */
export async function invoiceLinkPdf(token: unknown, meta: { ip: string }, today = todayInSweden()): Promise<{ bytes: Uint8Array; fileName: string }> {
  await allowed(meta.ip);
  const row = await loadLink(token);
  const content: InvoiceContent | null = row ? invoiceContentOf(row.content) : null;
  if (!row || !content || invoiceLinkState(row, today) !== "open") throw new ApiError(404, "Länken fungerar inte längre. Kontakta företaget.");
  const digits = openValue("invoice-identity", row.identitySealed, row.organizationId, "invoice-identity");
  const bytes = new Uint8Array(await createCustomerInvoicePdf({ identity: await workflowReportIdentity(row.organizationId, content.seller.name), fontBytes: await workflowReportFont(), content, personalNumber: digits ? `${digits.slice(0, 8)}-${digits.slice(8)}` : "" }));
  await logLink(row, "downloaded", "Kunden laddade ner PDF via länken.");
  await prisma.administrationEvent.create({ data: { organizationId: row.organizationId, actorId: "system:customer-invoice-link", action: "customer_invoice_link_pdf", detail: `Kunden laddade ner ${row.label} via länken.` } });
  return { bytes, fileName: `${content.kind === "CREDIT" ? "kreditfaktura" : "faktura"}-${row.label.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf` };
}
