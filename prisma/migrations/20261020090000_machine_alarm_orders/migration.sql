-- Larm blir arbetsorder (steg S3). Additive only: two columns with defaults on MachineSource and one new table.
-- At most ONE open row (pending or created) per source is guaranteed by a partial unique index, so two alarms arriving
-- at the same moment can never make two automatic orders.

-- AlterTable
ALTER TABLE "MachineSource" ADD COLUMN "alarmMode" TEXT NOT NULL DEFAULT 'direct',
ADD COLUMN "cooldownMinutes" INTEGER NOT NULL DEFAULT 30,
ADD CONSTRAINT "MachineSource_alarmMode_check" CHECK ("alarmMode" IN ('off', 'direct', 'approval')),
ADD CONSTRAINT "MachineSource_cooldown_check" CHECK ("cooldownMinutes" BETWEEN 1 AND 1440);

-- CreateTable
CREATE TABLE "MachineAlarmOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "eventRef" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "MachineAlarmOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MachineAlarmOrder_status_check" CHECK ("status" IN ('pending', 'created', 'dismissed', 'closed'))
);

-- CreateIndex
CREATE INDEX "MachineAlarmOrder_organizationId_createdAt_idx" ON "MachineAlarmOrder"("organizationId", "createdAt");
CREATE INDEX "MachineAlarmOrder_sourceId_createdAt_idx" ON "MachineAlarmOrder"("sourceId", "createdAt");
CREATE UNIQUE INDEX "MachineAlarmOrder_one_open_per_source" ON "MachineAlarmOrder"("sourceId") WHERE "status" IN ('pending', 'created');

-- AddForeignKey
ALTER TABLE "MachineAlarmOrder" ADD CONSTRAINT "MachineAlarmOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineAlarmOrder" ADD CONSTRAINT "MachineAlarmOrder_sourceId_organizationId_fkey" FOREIGN KEY ("sourceId", "organizationId") REFERENCES "MachineSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
