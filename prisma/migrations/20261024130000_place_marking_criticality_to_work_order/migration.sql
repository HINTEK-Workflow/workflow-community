-- Kritikalitet och märkning till arbetsordern (2026-10-24): they belong to the work order itself, not to the place.
-- The work order keeps them in its JSON data (details.maintenance.criticality and .marking), so nothing is added here;
-- the place's columns are dropped without moving their values (all data so far is test data, by decision).
DROP INDEX IF EXISTS "CustomerFacility_organizationId_customerId_criticality_idx";
ALTER TABLE "CustomerFacility" DROP CONSTRAINT IF EXISTS "CustomerFacility_criticality_check";
ALTER TABLE "CustomerFacility" DROP COLUMN IF EXISTS "criticality";
ALTER TABLE "CustomerFacility" DROP COLUMN IF EXISTS "code";
