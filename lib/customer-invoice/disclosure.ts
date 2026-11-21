import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { openValue } from "@/lib/security/key-ring";
import { DISCLOSURE_REASON_MIN } from "@/lib/staff-register/model";
import { invoiceContentOf, invoiceRetainedThrough, type InvoiceContent } from "@/lib/customer-invoice/model";

/**
 * Fakturor på begäran (owner's decision 2026-11-04), the same way out as Personalliggare på begäran: a company that is erased or
 * switched off has no login and its invoicing setting is gone, so nobody can browse what is kept. Only the superadmin can hand one
 * invoice out at a time, with a required reason written to the company's history. The list shows the company, the count and the
 * dates, nothing else of the invoices.
 */
export type InvoiceDisclosureCompany = { id: string; name: string; erased: boolean; rows: number; from: string; to: string; keptThrough: string };

export async function invoiceDisclosureCandidates(): Promise<InvoiceDisclosureCompany[]> {
  const rows = await prisma.$queryRaw<{ id: string; name: string; slug: string; rows: number; from: string; to: string }[]>`SELECT o."id", o."name", o."slug", COUNT(*)::int AS "rows", MIN(i."issuedOn") AS "from", MAX(i."issuedOn") AS "to"
    FROM "CustomerInvoice" i JOIN "Organization" o ON o."id" = i."organizationId" WHERE o."isActive" = FALSE GROUP BY o."id", o."name", o."slug" ORDER BY MAX(i."issuedOn") DESC LIMIT 500`;
  return rows.map((row) => ({ id: row.id, name: row.name, erased: row.slug === `raderat-${row.id}`, rows: row.rows, from: row.from, to: row.to, keptThrough: invoiceRetainedThrough(row.to) }));
}

export const invoiceDisclosureSchema = z.object({
  organizationId: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1, "Skriv fakturanumret.").max(40),
  reason: z.string().trim().min(DISCLOSURE_REASON_MIN, "Skriv varför fakturan lämnas ut.").max(500),
});

/** One invoice of an inactive company: the snapshot and the opened number, with the reason in the company's history, never the number. */
export async function discloseInvoice(input: z.output<typeof invoiceDisclosureSchema>, actorId: string): Promise<{ content: InvoiceContent; personalNumber: string }> {
  const [row] = await prisma.$queryRaw<{ id: string; label: string; content: unknown; identitySealed: string | null }[]>`SELECT i."id", i."label", i."content", i."identitySealed" FROM "CustomerInvoice" i JOIN "Organization" o ON o."id" = i."organizationId"
    WHERE i."organizationId" = ${input.organizationId} AND i."label" = ${input.label} AND o."isActive" = FALSE`;
  const content = row ? invoiceContentOf(row.content) : null;
  if (!row || !content) throw new ApiError(404, "Det finns ingen sådan faktura hos ett inaktivt företag.");
  await prisma.administrationEvent.create({ data: { organizationId: input.organizationId, actorId, action: "customer_invoice_disclosure", detail: `Lämnade ut ${row.label} på begäran. Skäl: ${input.reason}`.slice(0, 500) } });
  const digits = openValue("invoice-identity", row.identitySealed, input.organizationId, "invoice-identity");
  return { content, personalNumber: digits ? `${digits.slice(0, 8)}-${digits.slice(8)}` : "" };
}
