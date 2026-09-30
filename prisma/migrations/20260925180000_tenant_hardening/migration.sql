-- Tenant hardening. Verified before migration on kfid_v3_test: no cross-tenant customer or project-event references.

-- Project history rows can only reference a project in the same organization.
ALTER TABLE "ProjectEvent" DROP CONSTRAINT "ProjectEvent_projectId_fkey";
ALTER TABLE "ProjectEvent" ADD CONSTRAINT "ProjectEvent_projectId_organizationId_fkey"
  FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Projects, workflow tasks and controls may only reference a customer in their own organization.
-- A trigger is used instead of a composite FK because purging a customer must keep SET NULL on customerId only
-- (organizationId is required), which Prisma cannot model. Prisma does not manage triggers, so they are not drift.
CREATE OR REPLACE FUNCTION "workflow_assert_customer_tenant"() RETURNS trigger AS $$
BEGIN
  IF NEW."customerId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Customer" WHERE "id" = NEW."customerId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Kunden tillhör inte samma organisation.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Project_customer_tenant" BEFORE INSERT OR UPDATE OF "customerId", "organizationId" ON "Project"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_customer_tenant"();
CREATE TRIGGER "WorkflowTask_customer_tenant" BEFORE INSERT OR UPDATE OF "customerId", "organizationId" ON "WorkflowTask"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_customer_tenant"();
CREATE TRIGGER "Control_customer_tenant" BEFORE INSERT OR UPDATE OF "customerId", "organizationId" ON "Control"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_customer_tenant"();
