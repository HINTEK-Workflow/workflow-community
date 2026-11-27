-- Underhåll som ett enklare underhållssystem (2026-11-27, docs/beslut/underhall-cmms-2026-11-27.md):
-- 1. Gör i driftronden: en underhållsplan kan peka på en driftrond (MaintenancePlan.roundScheduleId). Då blir varje tillfälle
--    en underhållspost i rondens arbetsorder (MaintenanceItem.maintenancePlanId + planDue) i stället för en egen arbetsorder.
-- 2. Vad som ska göras: planen får en kort checklista (MaintenancePlan.checklist) som följer med till tillfällets post
--    (MaintenanceItem.instruction och MaintenanceItem.checklist).
--
-- Bara additivt: nya kolumner (nullbara eller med DEFAULT), nya index, nya främmande nycklar och nya CHECK-villkor som bara
-- gäller rader som har de nya värdena. Ingen befintlig rad skrivs om; den gamla appen läser och skriver aldrig kolumnerna.
-- Planens rond och postens plan är sammansatta nycklar ([id, organizationId]), så databasen själv vägrar en rond eller en
-- plan i ett annat företag. Driftronder tas aldrig bort på riktigt (deletedAt), så NO ACTION hindrar inget i vardagen; ett
-- helt företag tas bort i en sats som förut. CREATE INDEX görs utan CONCURRENTLY eftersom filen är en transaktion; indexen
-- är på nya kolumner som bara har NULL, så de byggs direkt.

BEGIN;

-- AlterTable
ALTER TABLE "MaintenancePlan" ADD COLUMN "checklist" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "roundScheduleId" TEXT;

-- AlterTable
ALTER TABLE "MaintenanceItem" ADD COLUMN "instruction" TEXT NOT NULL DEFAULT '',
ADD COLUMN "checklist" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "maintenancePlanId" TEXT,
ADD COLUMN "planDue" TEXT;

-- CreateIndex
CREATE INDEX "MaintenancePlan_organizationId_roundScheduleId_idx" ON "MaintenancePlan"("organizationId", "roundScheduleId");

-- CreateIndex
CREATE INDEX "MaintenanceItem_organizationId_maintenancePlanId_planDue_idx" ON "MaintenanceItem"("organizationId", "maintenancePlanId", "planDue");

-- Inga dubbletter: högst en post per plan och dag (partiellt unikt index; Prisma kan inte uttrycka det i schemat).
CREATE UNIQUE INDEX "MaintenanceItem_plan_due_key" ON "MaintenanceItem"("organizationId", "maintenancePlanId", "planDue") WHERE "maintenancePlanId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_roundScheduleId_organizationId_fkey" FOREIGN KEY ("roundScheduleId", "organizationId") REFERENCES "FormSchedule"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_maintenancePlanId_organizationId_fkey" FOREIGN KEY ("maintenancePlanId", "organizationId") REFERENCES "MaintenancePlan"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------- Villkor ----------
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_checklist_check" CHECK (jsonb_typeof("checklist") = 'array' AND jsonb_array_length("checklist") <= 30);
ALTER TABLE "MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_checklist_check" CHECK (jsonb_typeof("checklist") = 'array' AND jsonb_array_length("checklist") <= 30);
-- Ett tillfälle i ronden har alltid sin plan och sin dag, och kommer alltid från planen (source PLAN).
ALTER TABLE "MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_plan_due_check" CHECK (
  ("maintenancePlanId" IS NULL AND "planDue" IS NULL)
  OR ("maintenancePlanId" IS NOT NULL AND "source" = 'PLAN' AND "planDue" ~ '^\d{4}-\d{2}-\d{2}$')
);

COMMIT;
