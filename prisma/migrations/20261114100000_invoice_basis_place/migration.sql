-- Plats på fakturaunderlaget (Lika är rätt, 2026-11-14): a basis may name the customer's place it is about. Additive: one
-- optional column; the old app never reads it. The composite key keeps the place inside the company, and a deleted place clears
-- only this column. An invoiced basis stays locked: its place may be cleared (the place was deleted) but never set or changed.
BEGIN;

-- AlterTable
ALTER TABLE "InvoiceBasis" ADD COLUMN     "facilityId" TEXT;

-- AddForeignKey
ALTER TABLE "InvoiceBasis" ADD CONSTRAINT "InvoiceBasis_facilityId_organizationId_fkey" FOREIGN KEY ("facilityId", "organizationId") REFERENCES "CustomerFacility"("id", "organizationId") ON DELETE SET NULL ("facilityId") ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "workflow_invoice_basis_locked"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'INVOICED' AND (
      NEW."status" IS DISTINCT FROM OLD."status" OR NEW."lines" IS DISTINCT FROM OLD."lines" OR NEW."number" IS DISTINCT FROM OLD."number"
      OR NEW."title" IS DISTINCT FROM OLD."title" OR NEW."vatPercent" IS DISTINCT FROM OLD."vatPercent" OR NEW."note" IS DISTINCT FROM OLD."note"
      OR NEW."invoicedAt" IS DISTINCT FROM OLD."invoicedAt" OR NEW."invoicedById" IS DISTINCT FROM OLD."invoicedById"
      OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
      OR (NEW."taskId" IS NOT NULL AND NEW."taskId" IS DISTINCT FROM OLD."taskId")
      OR (NEW."projectId" IS NOT NULL AND NEW."projectId" IS DISTINCT FROM OLD."projectId")
      OR (NEW."customerId" IS NOT NULL AND NEW."customerId" IS DISTINCT FROM OLD."customerId")
      OR (NEW."facilityId" IS NOT NULL AND NEW."facilityId" IS DISTINCT FROM OLD."facilityId")) THEN
    RAISE EXCEPTION 'Ett fakturerat underlag kan inte ändras.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
