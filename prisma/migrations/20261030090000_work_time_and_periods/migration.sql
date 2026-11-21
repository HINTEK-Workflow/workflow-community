-- Arbetstid och tidsperioder (2026-10-30): the company's workday (only a suggestion in the time report), the retention of
-- absence chosen per company, "Ingen fast arbetstid" per person, and the month of time a person sends in and a supervisor
-- approves before payroll. Additive only: new columns with defaults and one new table; nothing existing is changed or deleted.
-- Its own transaction: Prisma runs a file statement by statement (tests/migration-interrupted.integration.ts).
BEGIN;

ALTER TABLE "Organization" ADD COLUMN "workdayStartMinutes" INTEGER NOT NULL DEFAULT 420;
ALTER TABLE "Organization" ADD COLUMN "workdayEndMinutes" INTEGER NOT NULL DEFAULT 960;
ALTER TABLE "Organization" ADD COLUMN "absenceRetentionMonths" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_workday_check"
  CHECK ("workdayStartMinutes" BETWEEN 0 AND 1439 AND "workdayEndMinutes" BETWEEN 1 AND 1440 AND "workdayStartMinutes" < "workdayEndMinutes");
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_absenceRetentionMonths_check" CHECK ("absenceRetentionMonths" BETWEEN 1 AND 120);

ALTER TABLE "OrganizationMember" ADD COLUMN "noFixedHours" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TimePeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimePeriod_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TimePeriod_period_check" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "TimePeriod_status_check" CHECK ("status" IN ('SUBMITTED', 'APPROVED', 'RETURNED')),
    CONSTRAINT "TimePeriod_note_check" CHECK (char_length("note") <= 500)
);
CREATE UNIQUE INDEX "TimePeriod_organizationId_userId_period_key" ON "TimePeriod"("organizationId", "userId", "period");
CREATE INDEX "TimePeriod_organizationId_period_status_idx" ON "TimePeriod"("organizationId", "period", "status");
ALTER TABLE "TimePeriod" ADD CONSTRAINT "TimePeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimePeriod" ADD CONSTRAINT "TimePeriod_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
