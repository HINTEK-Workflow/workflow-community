-- Underhåll stage 2 (2026-10-06): object data on a place. Additive columns with defaults; a place without
-- object data reads exactly as before.
ALTER TABLE "CustomerFacility" ADD COLUMN "objectType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CustomerFacility" ADD COLUMN "criticality" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CustomerFacility" ADD COLUMN "operatingState" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CustomerFacility" ADD COLUMN "manufacturer" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CustomerFacility" ADD COLUMN "model" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CustomerFacility" ADD COLUMN "serialNumber" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CustomerFacility" ADD COLUMN "installedOn" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CustomerFacility" ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "CustomerFacility" ADD CONSTRAINT "CustomerFacility_criticality_check" CHECK ("criticality" IN ('', 'A', 'B', 'C'));
ALTER TABLE "CustomerFacility" ADD CONSTRAINT "CustomerFacility_operatingState_check" CHECK ("operatingState" IN ('', 'IN_SERVICE', 'OUT_OF_SERVICE', 'DECOMMISSIONED'));
ALTER TABLE "CustomerFacility" ADD CONSTRAINT "CustomerFacility_attributes_check" CHECK (jsonb_typeof("attributes") = 'array');
CREATE INDEX "CustomerFacility_organizationId_customerId_criticality_idx" ON "CustomerFacility"("organizationId", "customerId", "criticality");
CREATE INDEX "CustomerFacility_organizationId_objectType_idx" ON "CustomerFacility"("organizationId", "objectType");
