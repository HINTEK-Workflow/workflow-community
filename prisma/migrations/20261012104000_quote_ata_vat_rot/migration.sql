-- Offert steg C, moms och ROT (2026-10-09, docs/proposals/material-pris-offert-2026-10-09.md).
--
-- Additive only: every existing quote gets customer type COMPANY, no ROT, no ÄTA link and no work order; every existing
-- line gets rotLabour = false. Nothing is rewritten or deleted.
--
-- 1. Customer type (company / private person) and, for a private person, an optional ROT deduction with the share and
--    cap the company entered – the company's own figures, copied to the quote so a sent quote never changes.
-- 2. ÄTA (change and extra work): a new version of an accepted quote names the accepted version it changes.
-- 3. Accepted quote -> work order: the latest work order made from the quote. Organisation-bound through a composite key
--    [workOrderId, organizationId] -> WorkflowTask[id, organizationId]; deleting the work order clears only this column
--    (column list, PostgreSQL 15+), never the quote's organizationId.
-- 4. The lock on a quote that is no longer a draft now also covers the new contents (customer type, ROT, ÄTA link).
--    The work order link may be set on an accepted quote; the status rules are unchanged.

-- CreateEnum
CREATE TYPE "QuoteCustomerType" AS ENUM ('COMPANY', 'PRIVATE');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "customerType" "QuoteCustomerType" NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "rotEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rotPercent" DECIMAL(5,2),
ADD COLUMN     "rotCap" DECIMAL(12,2),
ADD COLUMN     "changeOfVersion" INTEGER,
ADD COLUMN     "workOrderId" TEXT;

-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN     "rotLabour" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Quote_organizationId_workOrderId_idx" ON "Quote"("organizationId", "workOrderId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_workOrderId_organizationId_fkey" FOREIGN KEY ("workOrderId", "organizationId") REFERENCES "WorkflowTask"("id", "organizationId") ON DELETE SET NULL ("workOrderId") ON UPDATE CASCADE;

-- ---------- A sent quote is locked (now also customer type, ROT and the ÄTA link) ----------
CREATE OR REPLACE FUNCTION "workflow_quote_locked"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  -- The status moves only forward from Skickad; a decided quote keeps its status.
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (OLD."status" = 'SENT' AND NEW."status" IN ('ACCEPTED', 'DECLINED', 'EXPIRED')) THEN
    RAISE EXCEPTION 'Offerten är låst: statusen kan inte ändras så.' USING ERRCODE = '23514';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."number" IS DISTINCT FROM OLD."number"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."description" IS DISTINCT FROM OLD."description"
    OR NEW."validUntil" IS DISTINCT FROM OLD."validUntil"
    OR NEW."terms" IS DISTINCT FROM OLD."terms"
    OR NEW."vatPercent" IS DISTINCT FROM OLD."vatPercent"
    OR NEW."customerType" IS DISTINCT FROM OLD."customerType"
    OR NEW."rotEnabled" IS DISTINCT FROM OLD."rotEnabled"
    OR NEW."rotPercent" IS DISTINCT FROM OLD."rotPercent"
    OR NEW."rotCap" IS DISTINCT FROM OLD."rotCap"
    OR NEW."changeOfVersion" IS DISTINCT FROM OLD."changeOfVersion"
    OR NEW."sentAt" IS DISTINCT FROM OLD."sentAt"
    -- A purge may clear a link; it may never point somewhere else.
    OR (NEW."customerId" IS DISTINCT FROM OLD."customerId" AND NEW."customerId" IS NOT NULL)
    OR (NEW."facilityId" IS DISTINCT FROM OLD."facilityId" AND NEW."facilityId" IS NOT NULL)
    OR (NEW."projectId" IS DISTINCT FROM OLD."projectId" AND NEW."projectId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Offerten är skickad och låst. Gör en ny version för att ändra den.' USING ERRCODE = '23514';
  END IF;
  -- Only an accepted quote gets a work order made from it.
  IF NEW."workOrderId" IS NOT NULL AND NEW."workOrderId" IS DISTINCT FROM OLD."workOrderId" AND NEW."status" <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'Bara en accepterad offert kan bli en arbetsorder.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
