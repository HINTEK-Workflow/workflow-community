-- Avvikelser som allmän logg (2026-10-30: deviation handling is not a part of the egenkontroll programme): a deviation
-- no longer needs a programme, and its number is unique per company. A company has at most one programme (unique
-- organizationId + scopeKey, one scope), so every existing number is already unique per company. Nothing is deleted.
-- Its own transaction: Prisma runs a file statement by statement (tests/migration-interrupted.integration.ts).
BEGIN;

ALTER TABLE "SelfInspectionDeviation" ALTER COLUMN "programId" DROP NOT NULL;
CREATE UNIQUE INDEX "SelfInspectionDeviation_organizationId_number_key" ON "SelfInspectionDeviation"("organizationId", "number");

COMMIT;
