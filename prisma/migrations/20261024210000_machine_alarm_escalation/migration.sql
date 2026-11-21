-- Integrationsmotorn E6 (2026-10-24, plan docs/proposals/integrationsmotor-plan-2026-10-24.md, beslut 2026-10-18 punkt 4 och 6):
-- ansvarig och ersättare per objekt med eskalering, när larmnotiser får gå ut (dagtid som förval, dygnet runt bara när en
-- administratör valt det och personen själv sagt ja), kvittensens tid och en dygnssammanfattning per objekt som sparas
-- 24 månader. Additiv: nya kolumner med förval och två nya tabeller. Alla data hittills är testdata.

-- Företagets val: när larmnotiser går ut och hur länge ett steg väntar på kvittens.
ALTER TABLE "Organization" ADD COLUMN     "machineAlarmHours" TEXT NOT NULL DEFAULT 'day',
ADD COLUMN     "machineEscalationMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_machineAlarm_check" CHECK ("machineAlarmHours" IN ('day', 'always') AND "machineEscalationMinutes" BETWEEN 5 AND 240);

-- Personens eget ja till maskinlarm på natten (av från början).
ALTER TABLE "NoticePreference" ADD COLUMN     "machineAlarmNight" BOOLEAN NOT NULL DEFAULT false;

-- Larmradens eskalering och kvittens.
ALTER TABLE "MachineAlarmOrder" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedById" TEXT,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "escalationStep" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MachineAlarmOrder" ADD CONSTRAINT "MachineAlarmOrder_escalationStep_check" CHECK ("escalationStep" BETWEEN 0 AND 5);

-- Ansvarig och ersättare per objekt: sammansatta FK till objektet och till medlemskapet i samma företag.
CREATE TABLE "MachineAlarmContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineAlarmContact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MachineAlarmContact_role_check" CHECK ("role" IN ('responsible', 'deputy'))
);

-- Dygnssammanfattning per objekt (svensk kalenderdag).
CREATE TABLE "MachineDaySummary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "events" INTEGER NOT NULL DEFAULT 0,
    "alarms" INTEGER NOT NULL DEFAULT 0,
    "faults" INTEGER NOT NULL DEFAULT 0,
    "stops" INTEGER NOT NULL DEFAULT 0,
    "stoppedMinutes" INTEGER NOT NULL DEFAULT 0,
    "endState" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineDaySummary_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MachineDaySummary_values_check" CHECK ("day" ~ '^\d{4}-\d{2}-\d{2}$' AND "events" >= 0 AND "alarms" >= 0 AND "faults" >= 0 AND "faults" <= "alarms"
      AND "stops" >= 0 AND "stoppedMinutes" BETWEEN 0 AND 1500 AND ("endState" IS NULL OR "endState" IN ('running', 'stopped')))
);

CREATE INDEX "MachineAlarmContact_organizationId_userId_idx" ON "MachineAlarmContact"("organizationId", "userId");
CREATE UNIQUE INDEX "MachineAlarmContact_facilityId_role_key" ON "MachineAlarmContact"("facilityId", "role");
CREATE INDEX "MachineDaySummary_organizationId_day_idx" ON "MachineDaySummary"("organizationId", "day");
CREATE UNIQUE INDEX "MachineDaySummary_facilityId_day_key" ON "MachineDaySummary"("facilityId", "day");
CREATE INDEX "MachineAlarmOrder_status_acknowledgedAt_idx" ON "MachineAlarmOrder"("status", "acknowledgedAt");

ALTER TABLE "MachineAlarmContact" ADD CONSTRAINT "MachineAlarmContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineAlarmContact" ADD CONSTRAINT "MachineAlarmContact_facilityId_organizationId_fkey" FOREIGN KEY ("facilityId", "organizationId") REFERENCES "CustomerFacility"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineAlarmContact" ADD CONSTRAINT "MachineAlarmContact_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineDaySummary" ADD CONSTRAINT "MachineDaySummary_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineDaySummary" ADD CONSTRAINT "MachineDaySummary_facilityId_organizationId_fkey" FOREIGN KEY ("facilityId", "organizationId") REFERENCES "CustomerFacility"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
