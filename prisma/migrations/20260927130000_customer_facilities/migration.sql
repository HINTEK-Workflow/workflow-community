-- Customer facilities (2026-09-26, decision 11/D9 B). Additive: a new register under the customer and an
-- optional link from projects, workflow tasks and controls. The organization's own places stay in "Site" ("Platser").
CREATE TABLE "CustomerFacility" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "postalCode" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerFacility_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerFacility_id_organizationId_key" ON "CustomerFacility"("id", "organizationId");
CREATE INDEX "CustomerFacility_organizationId_customerId_isActive_idx" ON "CustomerFacility"("organizationId", "customerId", "isActive");

ALTER TABLE "CustomerFacility" ADD CONSTRAINT "CustomerFacility_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerFacility" ADD CONSTRAINT "CustomerFacility_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Project" ADD COLUMN "facilityId" TEXT;
ALTER TABLE "WorkflowTask" ADD COLUMN "facilityId" TEXT;
ALTER TABLE "Control" ADD COLUMN "facilityId" TEXT;

ALTER TABLE "Project" ADD CONSTRAINT "Project_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "CustomerFacility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "CustomerFacility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Control" ADD CONSTRAINT "Control_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "CustomerFacility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A facility may only be linked within its own organization, and belongs to a customer in the same organization.
-- Checked only when the link itself changes, so that purging a customer (which clears customerId and facilityId
-- through separate cascades) never trips over a half-applied state. The customer match is checked by the API.
CREATE OR REPLACE FUNCTION "workflow_assert_facility_tenant"() RETURNS trigger AS $$
BEGIN
  IF NEW."facilityId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."facilityId" IS DISTINCT FROM OLD."facilityId" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId") AND NOT EXISTS (
    SELECT 1 FROM "CustomerFacility" WHERE "id" = NEW."facilityId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Anläggningen tillhör inte samma organisation.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Project_facility_tenant" BEFORE INSERT OR UPDATE OF "facilityId", "organizationId" ON "Project"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_facility_tenant"();
CREATE TRIGGER "WorkflowTask_facility_tenant" BEFORE INSERT OR UPDATE OF "facilityId", "organizationId" ON "WorkflowTask"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_facility_tenant"();
CREATE TRIGGER "Control_facility_tenant" BEFORE INSERT OR UPDATE OF "facilityId", "organizationId" ON "Control"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_facility_tenant"();

CREATE OR REPLACE FUNCTION "workflow_assert_facility_customer_tenant"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Customer" WHERE "id" = NEW."customerId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'Kunden tillhör inte samma organisation.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CustomerFacility_customer_tenant" BEFORE INSERT OR UPDATE OF "customerId", "organizationId" ON "CustomerFacility"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_facility_customer_tenant"();
