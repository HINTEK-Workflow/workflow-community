-- Tidstyper (2026-10-29, lib/workflow/time-types.ts): the company's own list of kinds of time (name, an optional payroll
-- code for exports, active, order) and the type on a time entry. Additive only: one new table and one nullable column; nothing
-- existing is changed or deleted. An entry without a type (every entry from before) is the company's standard type. No index on
-- the new column of the large time table: it is only read through its entries, and a type with time on it is never removed.
-- Its own transaction: Prisma runs a file statement by statement (tests/migration-interrupted.integration.ts).
BEGIN;

CREATE TABLE "TimeType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payrollCode" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeType_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TimeType_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 40),
    CONSTRAINT "TimeType_payrollCode_check" CHECK (char_length("payrollCode") <= 20),
    -- The standard type is always active.
    CONSTRAINT "TimeType_default_active_check" CHECK (NOT "isDefault" OR "active")
);
CREATE UNIQUE INDEX "TimeType_organizationId_name_key" ON "TimeType"("organizationId", "name");
CREATE INDEX "TimeType_organizationId_sortOrder_idx" ON "TimeType"("organizationId", "sortOrder");
-- Exactly one standard type per company (at most one here; the server creates the starting list with one).
CREATE UNIQUE INDEX "TimeType_organizationId_default_key" ON "TimeType"("organizationId") WHERE "isDefault";
ALTER TABLE "TimeType" ADD CONSTRAINT "TimeType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowTimeEntry" ADD COLUMN "timeTypeId" TEXT;
ALTER TABLE "WorkflowTimeEntry" ADD CONSTRAINT "WorkflowTimeEntry_timeTypeId_fkey" FOREIGN KEY ("timeTypeId") REFERENCES "TimeType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
