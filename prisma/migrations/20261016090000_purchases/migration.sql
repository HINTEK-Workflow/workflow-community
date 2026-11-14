-- Inköp och Artiklar (2026-10-16, docs/proposals/inkop-och-artiklar-2026-10-16.md).
--
-- Additive only: two new tables and an enum. Nothing existing is changed or removed.
-- 1. A purchase line points at its purchase through [purchaseId, organizationId] -> [id, organizationId], so the
--    database refuses a line in another company's purchase.
-- 2. Project, customer and work order keep a single-column SET NULL key (removing them only clears the link), and a
--    trigger checks that a new or changed link is within the same company (the work order must be a work order).
-- Prisma does not manage triggers, so they are not schema drift (same convention as 20260925180000_tenant_hardening).


-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'ORDERED', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "projectId" TEXT,
    "customerId" TEXT,
    "workOrderId" TEXT,
    "orderedAt" TIMESTAMP(3),
    "orderedById" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "unitPrice" DECIMAL(14,4),
    "supplierName" TEXT NOT NULL DEFAULT '',
    "catalogue" JSONB,
    "deliveredAt" TIMESTAMP(3),
    "deliveredById" TEXT,
    "sourceKind" TEXT,
    "sourceId" TEXT,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Purchase_organizationId_updatedAt_idx" ON "Purchase"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Purchase_organizationId_status_idx" ON "Purchase"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Purchase_organizationId_createdById_idx" ON "Purchase"("organizationId", "createdById");

-- CreateIndex
CREATE INDEX "Purchase_organizationId_projectId_idx" ON "Purchase"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "Purchase_organizationId_workOrderId_idx" ON "Purchase"("organizationId", "workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_id_organizationId_key" ON "Purchase"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_organizationId_number_key" ON "Purchase"("organizationId", "number");

-- CreateIndex
CREATE INDEX "PurchaseLine_organizationId_purchaseId_position_idx" ON "PurchaseLine"("organizationId", "purchaseId", "position");

-- CreateIndex
CREATE INDEX "PurchaseLine_organizationId_sourceKind_sourceId_idx" ON "PurchaseLine"("organizationId", "sourceKind", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseLine_id_organizationId_key" ON "PurchaseLine"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkflowTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_purchaseId_organizationId_fkey" FOREIGN KEY ("purchaseId", "organizationId") REFERENCES "Purchase"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Same company for project, customer and work order ----------
CREATE TRIGGER "Purchase_customer_tenant" BEFORE INSERT OR UPDATE OF "customerId", "organizationId" ON "Purchase"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_customer_tenant"();
CREATE TRIGGER "Purchase_project_tenant" BEFORE INSERT OR UPDATE OF "projectId", "organizationId" ON "Purchase"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_quote_project_tenant"();

CREATE OR REPLACE FUNCTION "workflow_assert_purchase_work_order_tenant"() RETURNS trigger AS $$
BEGIN
  IF NEW."workOrderId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."workOrderId" IS DISTINCT FROM OLD."workOrderId" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId") AND NOT EXISTS (
    SELECT 1 FROM "WorkflowTask" WHERE "id" = NEW."workOrderId" AND "organizationId" = NEW."organizationId" AND "kind" = 'WORK_ORDER'
  ) THEN
    RAISE EXCEPTION 'Arbetsordern tillhör inte samma organisation.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Purchase_work_order_tenant" BEFORE INSERT OR UPDATE OF "workOrderId", "organizationId" ON "Purchase"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_purchase_work_order_tenant"();
