-- Fakturaunderlag från utfört arbete (2026-10-10, kartläggningen 5.6). Additive: two new tables and an enum.
-- A basis belongs to one job (taskId) or one project (projectId), never both; deleting the job or project keeps the
-- basis (only that column is cleared). InvoiceBasisSource's unique key (organizationId, sourceKey) is what keeps a time
-- entry or a material/expense row from ever being on two bases. An invoiced basis is locked by a trigger.

CREATE TYPE "InvoiceBasisStatus" AS ENUM ('DRAFT', 'INVOICED');

CREATE TABLE "InvoiceBasis" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "taskId" TEXT,
    "projectId" TEXT,
    "customerId" TEXT,
    "title" TEXT NOT NULL,
    "status" "InvoiceBasisStatus" NOT NULL DEFAULT 'DRAFT',
    "vatPercent" DECIMAL(5,2) NOT NULL DEFAULT 25,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT NOT NULL DEFAULT '',
    "invoicedAt" TIMESTAMP(3),
    "invoicedById" TEXT,
    "invoicedByName" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "updatedById" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceBasis_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InvoiceBasis_one_subject" CHECK (NOT ("taskId" IS NOT NULL AND "projectId" IS NOT NULL))
);

CREATE TABLE "InvoiceBasisSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "basisId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceBasisSource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceBasis_organizationId_taskId_idx" ON "InvoiceBasis"("organizationId", "taskId");
CREATE INDEX "InvoiceBasis_organizationId_projectId_idx" ON "InvoiceBasis"("organizationId", "projectId");
CREATE INDEX "InvoiceBasis_organizationId_status_updatedAt_idx" ON "InvoiceBasis"("organizationId", "status", "updatedAt");
CREATE UNIQUE INDEX "InvoiceBasis_id_organizationId_key" ON "InvoiceBasis"("id", "organizationId");
CREATE UNIQUE INDEX "InvoiceBasis_organizationId_number_key" ON "InvoiceBasis"("organizationId", "number");
CREATE INDEX "InvoiceBasisSource_organizationId_basisId_idx" ON "InvoiceBasisSource"("organizationId", "basisId");
CREATE UNIQUE INDEX "InvoiceBasisSource_organizationId_sourceKey_key" ON "InvoiceBasisSource"("organizationId", "sourceKey");

ALTER TABLE "InvoiceBasis" ADD CONSTRAINT "InvoiceBasis_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Composite keys keep every link inside the company; a deleted job, project or customer clears only its own column.
ALTER TABLE "InvoiceBasis" ADD CONSTRAINT "InvoiceBasis_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "WorkflowTask"("id", "organizationId") ON DELETE SET NULL ("taskId") ON UPDATE CASCADE;
ALTER TABLE "InvoiceBasis" ADD CONSTRAINT "InvoiceBasis_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE SET NULL ("projectId") ON UPDATE CASCADE;
ALTER TABLE "InvoiceBasis" ADD CONSTRAINT "InvoiceBasis_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE SET NULL ("customerId") ON UPDATE CASCADE;
ALTER TABLE "InvoiceBasisSource" ADD CONSTRAINT "InvoiceBasisSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceBasisSource" ADD CONSTRAINT "InvoiceBasisSource_basisId_organizationId_fkey" FOREIGN KEY ("basisId", "organizationId") REFERENCES "InvoiceBasis"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- An invoiced basis is evidence: its content, number and the mark itself never change. Clearing a link column because
-- the job, project or customer was deleted is still allowed. Deleting is stopped by the server (a whole company's
-- erasure removes it with the company).
CREATE OR REPLACE FUNCTION "workflow_invoice_basis_locked"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'INVOICED' AND (
      NEW."status" IS DISTINCT FROM OLD."status" OR NEW."lines" IS DISTINCT FROM OLD."lines" OR NEW."number" IS DISTINCT FROM OLD."number"
      OR NEW."title" IS DISTINCT FROM OLD."title" OR NEW."vatPercent" IS DISTINCT FROM OLD."vatPercent" OR NEW."note" IS DISTINCT FROM OLD."note"
      OR NEW."invoicedAt" IS DISTINCT FROM OLD."invoicedAt" OR NEW."invoicedById" IS DISTINCT FROM OLD."invoicedById"
      OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
      OR (NEW."taskId" IS NOT NULL AND NEW."taskId" IS DISTINCT FROM OLD."taskId")
      OR (NEW."projectId" IS NOT NULL AND NEW."projectId" IS DISTINCT FROM OLD."projectId")
      OR (NEW."customerId" IS NOT NULL AND NEW."customerId" IS DISTINCT FROM OLD."customerId")) THEN
    RAISE EXCEPTION 'Ett fakturerat underlag kan inte ändras.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InvoiceBasis_locked" BEFORE UPDATE ON "InvoiceBasis"
  FOR EACH ROW EXECUTE FUNCTION "workflow_invoice_basis_locked"();
