-- Allvarlighetsgrad på avvikelser (2026-10-30): Låg, Normal, Hög or Akut, chosen when reporting; it colours the list
-- card. Additive: existing entries get Normal, or Hög when they were marked serious or with a personal injury. Nothing is deleted.
-- Its own transaction: Prisma runs a file statement by statement (tests/migration-interrupted.integration.ts).
BEGIN;

ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "severity" TEXT NOT NULL DEFAULT 'NORMAL';
UPDATE "SelfInspectionDeviation" SET "severity" = 'HIGH' WHERE "serious" = true OR "personalInjury" = true;
ALTER TABLE "SelfInspectionDeviation" ADD CONSTRAINT "SelfInspectionDeviation_severity_check" CHECK ("severity" IN ('LOW', 'NORMAL', 'HIGH', 'ACUTE'));

COMMIT;
