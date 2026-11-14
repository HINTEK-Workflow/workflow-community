-- Priser och offert, steg A + B (2026-10-09, docs/proposals/material-pris-offert-2026-10-09.md).
--
-- Additive only: one new column on WorkspaceSettings (the company's price and quote settings, empty by default) and two
-- new tables. Nothing existing is changed or removed.
--
-- 1. Quote and QuoteLine are bound to the company. A line points at its quote through a composite key
--    [quoteId, organizationId] -> [id, organizationId], so the database refuses a line in another company's quote.
-- 2. Customer, place and project keep a single-column SET NULL key (purging a customer or a place, or removing a
--    project, only clears the link), and a trigger checks that a new or changed link is within the same company – the
--    customer and place functions from 20260925180000_tenant_hardening and 20260927130000_customer_facilities, and a
--    new one for the project.
-- 3. A quote that is no longer a draft is locked: the database refuses new or changed lines and changes to its contents.
--    Only the status may move on (SENT -> ACCEPTED / DECLINED / EXPIRED), a newer version may mark it superseded, and a
--    purge may clear its customer, place or project. Deleting rows is not blocked here, so removing a company or a quote
--    in a cascade always works; the app itself deletes only drafts.
-- Prisma does not manage triggers, so they are not schema drift (same convention as 20260925180000_tenant_hardening).

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QuoteLineKind" AS ENUM ('MATERIAL', 'LABOUR', 'OTHER');

-- AlterTable
ALTER TABLE "WorkspaceSettings" ADD COLUMN     "priceSettings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersededAt" TIMESTAMP(3),
    "customerId" TEXT,
    "facilityId" TEXT,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" TEXT NOT NULL DEFAULT '',
    "terms" TEXT NOT NULL DEFAULT '',
    "vatPercent" DECIMAL(5,2) NOT NULL DEFAULT 25,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "QuoteLineKind" NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "unitPrice" DECIMAL(14,4),
    "markupPercent" DECIMAL(7,2),
    "catalogue" JSONB,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Quote_organizationId_updatedAt_idx" ON "Quote"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Quote_organizationId_status_idx" ON "Quote"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Quote_organizationId_customerId_idx" ON "Quote"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "Quote_organizationId_projectId_idx" ON "Quote"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_id_organizationId_key" ON "Quote"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_organizationId_number_version_key" ON "Quote"("organizationId", "number", "version");

-- CreateIndex
CREATE INDEX "QuoteLine_organizationId_quoteId_position_idx" ON "QuoteLine"("organizationId", "quoteId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLine_id_organizationId_key" ON "QuoteLine"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "CustomerFacility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_organizationId_fkey" FOREIGN KEY ("quoteId", "organizationId") REFERENCES "Quote"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Same company for customer, place and project ----------
CREATE TRIGGER "Quote_customer_tenant" BEFORE INSERT OR UPDATE OF "customerId", "organizationId" ON "Quote"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_customer_tenant"();
CREATE TRIGGER "Quote_facility_tenant" BEFORE INSERT OR UPDATE OF "facilityId", "organizationId" ON "Quote"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_facility_tenant"();

CREATE OR REPLACE FUNCTION "workflow_assert_quote_project_tenant"() RETURNS trigger AS $$
BEGIN
  IF NEW."projectId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."projectId" IS DISTINCT FROM OLD."projectId" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId") AND NOT EXISTS (
    SELECT 1 FROM "Project" WHERE "id" = NEW."projectId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Projektet tillhör inte samma organisation.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Quote_project_tenant" BEFORE INSERT OR UPDATE OF "projectId", "organizationId" ON "Quote"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_quote_project_tenant"();

-- ---------- A sent quote is locked ----------
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
    OR NEW."sentAt" IS DISTINCT FROM OLD."sentAt"
    -- A purge may clear a link; it may never point somewhere else.
    OR (NEW."customerId" IS DISTINCT FROM OLD."customerId" AND NEW."customerId" IS NOT NULL)
    OR (NEW."facilityId" IS DISTINCT FROM OLD."facilityId" AND NEW."facilityId" IS NOT NULL)
    OR (NEW."projectId" IS DISTINCT FROM OLD."projectId" AND NEW."projectId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Offerten är skickad och låst. Gör en ny version för att ändra den.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Quote_locked" BEFORE UPDATE ON "Quote"
  FOR EACH ROW EXECUTE FUNCTION "workflow_quote_locked"();

CREATE OR REPLACE FUNCTION "workflow_quote_line_locked"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Quote" WHERE "id" = NEW."quoteId" AND "organizationId" = NEW."organizationId" AND "status" <> 'DRAFT'
  ) OR (TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM "Quote" WHERE "id" = OLD."quoteId" AND "organizationId" = OLD."organizationId" AND "status" <> 'DRAFT'
  )) THEN
    RAISE EXCEPTION 'Offerten är skickad och låst. Gör en ny version för att ändra den.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "QuoteLine_locked" BEFORE INSERT OR UPDATE ON "QuoteLine"
  FOR EACH ROW EXECUTE FUNCTION "workflow_quote_line_locked"();
