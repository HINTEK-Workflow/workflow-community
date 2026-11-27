-- Underhåll (2026-10-30): maskinträdet, förrådet och underhållsposten, Cloud först (lib/maintenance/).
--
-- Additivt: nya tabeller, nya nullbara kolumner och nya index. Det enda som släpps är NOT NULL på
-- MachineAlarmContact.facilityId och MachineDaySummary.facilityId (nya rader har maskindelen i stället; den gamla appen
-- skriver fortfarande objektet, vilket CHECK-villkoren nedan tillåter). Inget tas bort här; borttagningen av
-- maskinobjekten i kundernas platsträd är ett eget steg (20261031090100_machine_objects_removed).
-- 1. Sammansatta FK där raden alltid har en förälder i samma företag (bild, reservdel, saldo, logg, post -> del).
-- 2. Enkla FK med SET NULL (arbetsorder, kund, artikel, maskindelen på maskinkopplingens tabeller) och triggrar som kräver
--    samma företag, som för Purchase (20261016090000_purchases). Prisma hanterar inte triggrar; de är ingen schemadrift.
-- 3. Ingen cykel i maskinträdet, och bara en rot får ha en kund som ägare.
-- CREATE INDEX på WorkflowTask och MachineEvent (stora tabeller) görs utan CONCURRENTLY eftersom filen är en transaktion;
-- indexen är på en ny kolumn som bara har NULL, så de byggs direkt.

BEGIN;

-- AlterTable
ALTER TABLE "WorkflowTask" ADD COLUMN     "machinePartId" TEXT;

-- AlterTable
ALTER TABLE "MachineSource" ADD COLUMN     "machinePartId" TEXT;

-- AlterTable
ALTER TABLE "MachineEvent" ADD COLUMN     "machinePartId" TEXT;

-- AlterTable
ALTER TABLE "MachineAlarmOrder" ADD COLUMN     "machinePartId" TEXT;

-- AlterTable
ALTER TABLE "MachineSignal" ADD COLUMN     "machinePartId" TEXT;

-- AlterTable
ALTER TABLE "MachineAlarmContact" ADD COLUMN     "machinePartId" TEXT,
ALTER COLUMN "facilityId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "MachineDaySummary" ADD COLUMN     "machinePartId" TEXT,
ALTER COLUMN "facilityId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "MachinePart" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "customerId" TEXT,
    "name" TEXT NOT NULL,
    "partType" TEXT NOT NULL DEFAULT '',
    "marking" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'IN_SERVICE',
    "notes" TEXT NOT NULL DEFAULT '',
    "runHours" DOUBLE PRECISION,
    "runHoursAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachinePart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachinePartImage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachinePartImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachinePartArticle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachinePartArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'STORE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "articleRef" TEXT,
    "articleId" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'st',
    "articleNo" TEXT NOT NULL DEFAULT '',
    "supplierName" TEXT NOT NULL DEFAULT '',
    "minQuantity" DECIMAL(14,4),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "change" DECIMAL(14,4) NOT NULL,
    "balanceAfter" DECIMAL(14,4) NOT NULL,
    "unitPrice" DECIMAL(14,4),
    "workOrderId" TEXT,
    "maintenanceItemId" TEXT,
    "machinePartId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "type" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT '',
    "criticality" TEXT NOT NULL DEFAULT '',
    "marking" TEXT NOT NULL DEFAULT '',
    "fault" TEXT NOT NULL DEFAULT '',
    "cause" TEXT NOT NULL DEFAULT '',
    "causeNote" TEXT NOT NULL DEFAULT '',
    "reportedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "machineAlarmOrderId" TEXT,
    "reportedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachinePart_organizationId_parentId_idx" ON "MachinePart"("organizationId", "parentId");

-- CreateIndex
CREATE INDEX "MachinePart_organizationId_customerId_idx" ON "MachinePart"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "MachinePart_id_organizationId_key" ON "MachinePart"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MachinePartImage_storagePath_key" ON "MachinePartImage"("storagePath");

-- CreateIndex
CREATE INDEX "MachinePartImage_organizationId_partId_idx" ON "MachinePartImage"("organizationId", "partId");

-- CreateIndex
CREATE INDEX "MachinePartArticle_organizationId_itemId_idx" ON "MachinePartArticle"("organizationId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "MachinePartArticle_partId_itemId_key" ON "MachinePartArticle"("partId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreLocation_id_organizationId_key" ON "StoreLocation"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreLocation_organizationId_name_key" ON "StoreLocation"("organizationId", "name");

-- CreateIndex
CREATE INDEX "StoreItem_organizationId_name_idx" ON "StoreItem"("organizationId", "name");

-- CreateIndex
CREATE INDEX "StoreItem_articleId_idx" ON "StoreItem"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreItem_id_organizationId_key" ON "StoreItem"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreItem_organizationId_articleRef_key" ON "StoreItem"("organizationId", "articleRef");

-- CreateIndex
CREATE INDEX "StoreBalance_organizationId_locationId_idx" ON "StoreBalance"("organizationId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreBalance_itemId_locationId_key" ON "StoreBalance"("itemId", "locationId");

-- CreateIndex
CREATE INDEX "StoreTransaction_organizationId_itemId_createdAt_idx" ON "StoreTransaction"("organizationId", "itemId", "createdAt");

-- CreateIndex
CREATE INDEX "StoreTransaction_organizationId_workOrderId_idx" ON "StoreTransaction"("organizationId", "workOrderId");

-- CreateIndex
CREATE INDEX "StoreTransaction_organizationId_machinePartId_idx" ON "StoreTransaction"("organizationId", "machinePartId");

-- CreateIndex
CREATE INDEX "StoreTransaction_maintenanceItemId_idx" ON "StoreTransaction"("maintenanceItemId");

-- CreateIndex
CREATE INDEX "MaintenanceItem_organizationId_partId_createdAt_idx" ON "MaintenanceItem"("organizationId", "partId", "createdAt");

-- CreateIndex
CREATE INDEX "MaintenanceItem_organizationId_workOrderId_idx" ON "MaintenanceItem"("organizationId", "workOrderId");

-- CreateIndex
CREATE INDEX "MaintenanceItem_organizationId_status_idx" ON "MaintenanceItem"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceItem_id_organizationId_key" ON "MaintenanceItem"("id", "organizationId");

-- CreateIndex
CREATE INDEX "WorkflowTask_machinePartId_idx" ON "WorkflowTask"("machinePartId");

-- CreateIndex
CREATE INDEX "MachineSource_machinePartId_idx" ON "MachineSource"("machinePartId");

-- CreateIndex
CREATE INDEX "MachineEvent_machinePartId_occurredAt_idx" ON "MachineEvent"("machinePartId", "occurredAt");

-- CreateIndex
CREATE INDEX "MachineAlarmOrder_machinePartId_idx" ON "MachineAlarmOrder"("machinePartId");

-- CreateIndex
CREATE INDEX "MachineSignal_machinePartId_idx" ON "MachineSignal"("machinePartId");

-- CreateIndex
CREATE UNIQUE INDEX "MachineAlarmContact_machinePartId_role_key" ON "MachineAlarmContact"("machinePartId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "MachineDaySummary_machinePartId_day_key" ON "MachineDaySummary"("machinePartId", "day");

-- AddForeignKey
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_machinePartId_fkey" FOREIGN KEY ("machinePartId") REFERENCES "MachinePart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineSource" ADD CONSTRAINT "MachineSource_machinePartId_fkey" FOREIGN KEY ("machinePartId") REFERENCES "MachinePart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineEvent" ADD CONSTRAINT "MachineEvent_machinePartId_fkey" FOREIGN KEY ("machinePartId") REFERENCES "MachinePart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineAlarmOrder" ADD CONSTRAINT "MachineAlarmOrder_machinePartId_fkey" FOREIGN KEY ("machinePartId") REFERENCES "MachinePart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineSignal" ADD CONSTRAINT "MachineSignal_machinePartId_fkey" FOREIGN KEY ("machinePartId") REFERENCES "MachinePart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineAlarmContact" ADD CONSTRAINT "MachineAlarmContact_machinePartId_organizationId_fkey" FOREIGN KEY ("machinePartId", "organizationId") REFERENCES "MachinePart"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineDaySummary" ADD CONSTRAINT "MachineDaySummary_machinePartId_organizationId_fkey" FOREIGN KEY ("machinePartId", "organizationId") REFERENCES "MachinePart"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachinePart" ADD CONSTRAINT "MachinePart_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachinePart" ADD CONSTRAINT "MachinePart_parentId_organizationId_fkey" FOREIGN KEY ("parentId", "organizationId") REFERENCES "MachinePart"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachinePart" ADD CONSTRAINT "MachinePart_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachinePartImage" ADD CONSTRAINT "MachinePartImage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachinePartImage" ADD CONSTRAINT "MachinePartImage_partId_organizationId_fkey" FOREIGN KEY ("partId", "organizationId") REFERENCES "MachinePart"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachinePartArticle" ADD CONSTRAINT "MachinePartArticle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachinePartArticle" ADD CONSTRAINT "MachinePartArticle_partId_organizationId_fkey" FOREIGN KEY ("partId", "organizationId") REFERENCES "MachinePart"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachinePartArticle" ADD CONSTRAINT "MachinePartArticle_itemId_organizationId_fkey" FOREIGN KEY ("itemId", "organizationId") REFERENCES "StoreItem"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreLocation" ADD CONSTRAINT "StoreLocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreItem" ADD CONSTRAINT "StoreItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreItem" ADD CONSTRAINT "StoreItem_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "CatalogueArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreBalance" ADD CONSTRAINT "StoreBalance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreBalance" ADD CONSTRAINT "StoreBalance_itemId_organizationId_fkey" FOREIGN KEY ("itemId", "organizationId") REFERENCES "StoreItem"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreBalance" ADD CONSTRAINT "StoreBalance_locationId_organizationId_fkey" FOREIGN KEY ("locationId", "organizationId") REFERENCES "StoreLocation"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreTransaction" ADD CONSTRAINT "StoreTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreTransaction" ADD CONSTRAINT "StoreTransaction_itemId_organizationId_fkey" FOREIGN KEY ("itemId", "organizationId") REFERENCES "StoreItem"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreTransaction" ADD CONSTRAINT "StoreTransaction_locationId_organizationId_fkey" FOREIGN KEY ("locationId", "organizationId") REFERENCES "StoreLocation"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreTransaction" ADD CONSTRAINT "StoreTransaction_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkflowTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreTransaction" ADD CONSTRAINT "StoreTransaction_maintenanceItemId_fkey" FOREIGN KEY ("maintenanceItemId") REFERENCES "MaintenanceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreTransaction" ADD CONSTRAINT "StoreTransaction_machinePartId_fkey" FOREIGN KEY ("machinePartId") REFERENCES "MachinePart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_partId_organizationId_fkey" FOREIGN KEY ("partId", "organizationId") REFERENCES "MachinePart"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkflowTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ---------- Regler i databasen ----------
ALTER TABLE "MachinePart" ADD CONSTRAINT "MachinePart_status_check" CHECK ("status" IN ('IN_SERVICE', 'SERVICE_SOON', 'OUT_OF_SERVICE', 'DECOMMISSIONED'));
ALTER TABLE "MachinePart" ADD CONSTRAINT "MachinePart_customer_root_check" CHECK ("parentId" IS NULL OR "customerId" IS NULL);
ALTER TABLE "MachinePart" ADD CONSTRAINT "MachinePart_not_own_parent_check" CHECK ("parentId" IS NULL OR "parentId" <> "id");
ALTER TABLE "MachinePart" ADD CONSTRAINT "MachinePart_runHours_check" CHECK ("runHours" IS NULL OR "runHours" >= 0);
ALTER TABLE "StoreLocation" ADD CONSTRAINT "StoreLocation_kind_check" CHECK ("kind" IN ('STORE', 'VEHICLE'));
ALTER TABLE "StoreBalance" ADD CONSTRAINT "StoreBalance_quantity_check" CHECK ("quantity" >= 0);
ALTER TABLE "StoreItem" ADD CONSTRAINT "StoreItem_minQuantity_check" CHECK ("minQuantity" IS NULL OR "minQuantity" >= 0);
ALTER TABLE "MachinePartArticle" ADD CONSTRAINT "MachinePartArticle_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "StoreTransaction" ADD CONSTRAINT "StoreTransaction_kind_check" CHECK ("kind" IN ('WITHDRAWAL', 'RETURN', 'RECEIPT', 'COUNT'));
ALTER TABLE "StoreTransaction" ADD CONSTRAINT "StoreTransaction_balanceAfter_check" CHECK ("balanceAfter" >= 0);
ALTER TABLE "MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_status_check" CHECK ("status" IN ('OPEN', 'DONE', 'CANCELLED'));
ALTER TABLE "MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_source_check" CHECK ("source" IN ('MANUAL', 'MACHINE_ALARM', 'OPERATOR'));
ALTER TABLE "MachineAlarmContact" ADD CONSTRAINT "MachineAlarmContact_one_target_check" CHECK (num_nonnulls("facilityId", "machinePartId") = 1);
ALTER TABLE "MachineDaySummary" ADD CONSTRAINT "MachineDaySummary_one_target_check" CHECK (num_nonnulls("facilityId", "machinePartId") = 1);

-- Högst en huvudbild per del.
CREATE UNIQUE INDEX "MachinePartImage_one_main_per_part" ON "MachinePartImage"("partId") WHERE "isMain";

-- Spärren "högst en öppen automatisk order" räknas nu på maskindelen (part:<id>); facility: står kvar för gamla rader.
ALTER TABLE "MachineAlarmOrder" DROP CONSTRAINT "MachineAlarmOrder_scopeKey_check";
ALTER TABLE "MachineAlarmOrder" ADD CONSTRAINT "MachineAlarmOrder_scopeKey_check" CHECK ("scopeKey" ~ '^(part|facility|signal|source):[A-Za-z0-9_-]{1,100}$');
ALTER TABLE "MachineSuggestion" DROP CONSTRAINT "MachineSuggestion_scopeKey_check";
ALTER TABLE "MachineSuggestion" ADD CONSTRAINT "MachineSuggestion_scopeKey_check" CHECK ("scopeKey" ~ '^(part|facility|signal|source):[A-Za-z0-9_-]{1,100}$');

-- ---------- Samma företag ----------
CREATE OR REPLACE FUNCTION "maintenance_assert_part_tenant"() RETURNS trigger AS $$
BEGIN
  IF NEW."machinePartId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."machinePartId" IS DISTINCT FROM OLD."machinePartId" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId") AND NOT EXISTS (
    SELECT 1 FROM "MachinePart" WHERE "id" = NEW."machinePartId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Maskindelen tillhör inte samma organisation.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WorkflowTask_machine_part_tenant" BEFORE INSERT OR UPDATE OF "machinePartId", "organizationId" ON "WorkflowTask"
  FOR EACH ROW EXECUTE FUNCTION "maintenance_assert_part_tenant"();
CREATE TRIGGER "MachineSource_machine_part_tenant" BEFORE INSERT OR UPDATE OF "machinePartId", "organizationId" ON "MachineSource"
  FOR EACH ROW EXECUTE FUNCTION "maintenance_assert_part_tenant"();
CREATE TRIGGER "MachineSignal_machine_part_tenant" BEFORE INSERT OR UPDATE OF "machinePartId", "organizationId" ON "MachineSignal"
  FOR EACH ROW EXECUTE FUNCTION "maintenance_assert_part_tenant"();
CREATE TRIGGER "MachineEvent_machine_part_tenant" BEFORE INSERT OR UPDATE OF "machinePartId", "organizationId" ON "MachineEvent"
  FOR EACH ROW EXECUTE FUNCTION "maintenance_assert_part_tenant"();
CREATE TRIGGER "MachineAlarmOrder_machine_part_tenant" BEFORE INSERT OR UPDATE OF "machinePartId", "organizationId" ON "MachineAlarmOrder"
  FOR EACH ROW EXECUTE FUNCTION "maintenance_assert_part_tenant"();
CREATE TRIGGER "StoreTransaction_machine_part_tenant" BEFORE INSERT OR UPDATE OF "machinePartId", "organizationId" ON "StoreTransaction"
  FOR EACH ROW EXECUTE FUNCTION "maintenance_assert_part_tenant"();

-- Rotens kund (samma funktion som Purchase och Quote).
CREATE TRIGGER "MachinePart_customer_tenant" BEFORE INSERT OR UPDATE OF "customerId", "organizationId" ON "MachinePart"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_customer_tenant"();

-- Arbetsordern för en post och ett uttag: samma företag och en arbetsorder (funktionen från 20261016090000_purchases).
CREATE TRIGGER "MaintenanceItem_work_order_tenant" BEFORE INSERT OR UPDATE OF "workOrderId", "organizationId" ON "MaintenanceItem"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_purchase_work_order_tenant"();
CREATE TRIGGER "StoreTransaction_work_order_tenant" BEFORE INSERT OR UPDATE OF "workOrderId", "organizationId" ON "StoreTransaction"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_purchase_work_order_tenant"();

-- Posten på en loggrad: samma företag.
CREATE OR REPLACE FUNCTION "maintenance_assert_item_tenant"() RETURNS trigger AS $$
BEGIN
  IF NEW."maintenanceItemId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."maintenanceItemId" IS DISTINCT FROM OLD."maintenanceItemId" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId") AND NOT EXISTS (
    SELECT 1 FROM "MaintenanceItem" WHERE "id" = NEW."maintenanceItemId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Underhållsposten tillhör inte samma organisation.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "StoreTransaction_item_tenant" BEFORE INSERT OR UPDATE OF "maintenanceItemId", "organizationId" ON "StoreTransaction"
  FOR EACH ROW EXECUTE FUNCTION "maintenance_assert_item_tenant"();

-- Registerartikeln: samma företag.
CREATE OR REPLACE FUNCTION "maintenance_assert_article_tenant"() RETURNS trigger AS $$
BEGIN
  IF NEW."articleId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."articleId" IS DISTINCT FROM OLD."articleId" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId") AND NOT EXISTS (
    SELECT 1 FROM "CatalogueArticle" WHERE "id" = NEW."articleId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Artikeln tillhör inte samma organisation.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "StoreItem_article_tenant" BEFORE INSERT OR UPDATE OF "articleId", "organizationId" ON "StoreItem"
  FOR EACH ROW EXECUTE FUNCTION "maintenance_assert_article_tenant"();

-- Ingen cykel: en ny förälder får inte vara delen själv eller något under den.
CREATE OR REPLACE FUNCTION "maintenance_assert_part_tree"() RETURNS trigger AS $$
BEGIN
  IF NEW."parentId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."parentId" IS DISTINCT FROM OLD."parentId") AND EXISTS (
    WITH RECURSIVE up("id", "parentId", "depth") AS (
      SELECT "id", "parentId", 1 FROM "MachinePart" WHERE "id" = NEW."parentId" AND "organizationId" = NEW."organizationId"
      UNION ALL
      SELECT p."id", p."parentId", up."depth" + 1 FROM "MachinePart" p JOIN up ON p."id" = up."parentId" WHERE up."depth" < 100
    )
    SELECT 1 FROM up WHERE up."id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'En del kan inte ligga under sig själv.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MachinePart_tree" BEFORE INSERT OR UPDATE OF "parentId" ON "MachinePart"
  FOR EACH ROW EXECUTE FUNCTION "maintenance_assert_part_tree"();

COMMIT;
