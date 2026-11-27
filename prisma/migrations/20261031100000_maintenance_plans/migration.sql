-- Återkommande underhåll (2026-10-30): en underhållsplan per maskindel, och en arbetsorder per tillfälle
-- (lib/maintenance/plan-model.ts, lib/maintenance/plan-server.ts).
--
-- Additivt: en ny tabell, nya nullbara kolumner (och en med DEFAULT) på WorkflowTask, ett nytt index och nya CHECK-villkor.
-- Den gamla appen skriver aldrig de nya kolumnerna, och villkoren gäller bara rader som har dem. Det enda befintliga som
-- ändras är CHECK-villkoret för MaintenanceItem.source, som får ett värde till (PLAN) – alla gamla värden gäller som förut.
-- Arbetsorderns plan är en sammansatt FK ([maintenancePlanId, organizationId]), så databasen själv vägrar en plan i ett annat
-- företag. CREATE INDEX på WorkflowTask görs utan CONCURRENTLY eftersom filen är en transaktion; indexet är på en ny kolumn
-- som bara har NULL, så det byggs direkt.

BEGIN;

-- AlterTable
ALTER TABLE "WorkflowTask" ADD COLUMN     "maintenanceActivatedAt" TIMESTAMP(3),
ADD COLUMN     "maintenanceDue" TEXT,
ADD COLUMN     "maintenancePinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maintenancePlanId" TEXT;

-- CreateTable
CREATE TABLE "MaintenancePlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL,
    "every" INTEGER NOT NULL,
    "startDate" TEXT NOT NULL,
    "nextRunHours" DOUBLE PRECISION,
    "assignedToUserId" TEXT,
    "assignedToName" TEXT NOT NULL DEFAULT '',
    "estimatedMinutes" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenancePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenancePlan_organizationId_partId_idx" ON "MaintenancePlan"("organizationId", "partId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenancePlan_id_organizationId_key" ON "MaintenancePlan"("id", "organizationId");

-- CreateIndex
CREATE INDEX "WorkflowTask_organizationId_maintenancePlanId_maintenanceDu_idx" ON "WorkflowTask"("organizationId", "maintenancePlanId", "maintenanceDue");

-- AddForeignKey
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_maintenancePlanId_organizationId_fkey" FOREIGN KEY ("maintenancePlanId", "organizationId") REFERENCES "MaintenancePlan"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_partId_organizationId_fkey" FOREIGN KEY ("partId", "organizationId") REFERENCES "MachinePart"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Villkor ----------
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_unit_check" CHECK ("unit" IN ('DAY', 'WEEK', 'MONTH', 'RUN_HOURS'));
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_every_check" CHECK ("every" > 0 AND "every" <= 1000000);
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_startDate_check" CHECK ("startDate" ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_nextRunHours_check" CHECK ("nextRunHours" IS NULL OR "nextRunHours" >= 0);
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_estimatedMinutes_check" CHECK ("estimatedMinutes" IS NULL OR "estimatedMinutes" >= 0);

-- Ett tillfälle är alltid en arbetsorder och har alltid sin dag; en dag utan plan finns inte.
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_maintenance_plan_check" CHECK (
  ("maintenancePlanId" IS NULL AND "maintenanceDue" IS NULL)
  OR ("maintenancePlanId" IS NOT NULL AND "kind" = 'WORK_ORDER' AND "maintenanceDue" ~ '^\d{4}-\d{2}-\d{2}$')
);

-- Underhållsposten från en plan (source PLAN).
ALTER TABLE "MaintenanceItem" DROP CONSTRAINT "MaintenanceItem_source_check";
ALTER TABLE "MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_source_check" CHECK ("source" IN ('MANUAL', 'MACHINE_ALARM', 'OPERATOR', 'PLAN'));

COMMIT;
