import { prisma } from "@/lib/db";
import { invoiceRetentionCutoff } from "./model";

/**
 * Nightly (history:retention, owner's decision 2026-11-04): the invoices an erased company keeps are removed when their time is
 * over (`invoiceRetentionCutoff`), the same model as the staff register. Only an erased company's: a live company's invoices are its
 * own. A credit goes first, and an invoice waits for a later credit of it, so the two always stand together. Each company gets one
 * counted line in its administration history; never a name or a number. `dryRun` only counts. The database lets these rows be deleted
 * only inside this transaction and only when they are old.
 */
export async function purgeRetainedInvoices(now = new Date(), options: { dryRun?: boolean } = {}) {
  const cutoff = invoiceRetentionCutoff(now);
  const companies = await prisma.$queryRaw<{ organizationId: string; invoices: number }[]>`SELECT i."organizationId", COUNT(*)::int AS "invoices" FROM "CustomerInvoice" i JOIN "Organization" o ON o."id" = i."organizationId"
    WHERE o."isActive" = FALSE AND o."slug" = 'raderat-' || o."id" AND i."issuedOn" < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM "CustomerInvoice" c WHERE c."creditOfId" = i."id" AND c."issuedOn" >= ${cutoff})
    GROUP BY i."organizationId"`;
  if (options.dryRun) return companies;
  const results: { organizationId: string; invoices: number }[] = [];
  for (const { organizationId } of companies) {
    const invoices = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL workflow.customer_invoice_purge = 'on'");
      const credits = await tx.$executeRaw`DELETE FROM "CustomerInvoice" WHERE "organizationId" = ${organizationId} AND "kind" = 'CREDIT' AND "issuedOn" < ${cutoff}`;
      const originals = await tx.$executeRaw`DELETE FROM "CustomerInvoice" i WHERE i."organizationId" = ${organizationId} AND i."kind" = 'INVOICE' AND i."issuedOn" < ${cutoff} AND NOT EXISTS (SELECT 1 FROM "CustomerInvoice" c WHERE c."creditOfId" = i."id")`;
      const count = credits + originals;
      if (count) await tx.administrationEvent.create({ data: { actorId: "system:customer-invoice-retention", organizationId, action: "customer_invoice_retention", detail: `Fakturor rensades efter bevarandetiden: ${count} ${count === 1 ? "faktura" : "fakturor"} från före ${cutoff}.` } });
      return count;
    }, { timeout: 120_000 });
    results.push({ organizationId, invoices });
  }
  return results;
}
