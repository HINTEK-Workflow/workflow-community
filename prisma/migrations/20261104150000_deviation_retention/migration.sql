-- Lagringstid för avvikelser, tillbud och olycksfall (decision 2026-11-04, docs/beslut/juridik-drift-och-kvalitet.md).
-- Additive: two marks and who set the first. No row changes; the nightly job decides from these and "closedAt".
BEGIN;
ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "retentionHoldAt" TIMESTAMP(3);
ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "retentionHoldById" TEXT;
ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "personalDataRemovedAt" TIMESTAMP(3);
COMMIT;
