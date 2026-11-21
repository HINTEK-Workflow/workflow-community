-- Granskningen 2026-10-20 (T1). Six earlier migrations (20261006150000, 20261006160000, 20261007153100 and their
-- followers) add these nine foreign keys only when no constraint of that name exists anywhere in the database:
-- "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = …)" without a schema. A database with more than one
-- schema – kfid_v3_test with its isolated test schemas – therefore built every later schema without the keys, while the
-- first schema had them. Here each key is created where it is missing, checked in the current schema only. Production
-- (one schema) already has all nine: nothing happens there. Additive; nothing is dropped or rewritten.
DO $$
DECLARE
  missing boolean;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Instrument_organizationId_fkey' AND connamespace = current_schema()::regnamespace) INTO missing;
  IF missing THEN
    ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CompanyReferenceValue_organizationId_fkey' AND connamespace = current_schema()::regnamespace) INTO missing;
  IF missing THEN
    ALTER TABLE "CompanyReferenceValue" ADD CONSTRAINT "CompanyReferenceValue_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionAssignment_organizationId_fkey' AND connamespace = current_schema()::regnamespace) INTO missing;
  IF missing THEN
    ALTER TABLE "SelfInspectionAssignment" ADD CONSTRAINT "SelfInspectionAssignment_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionAssignment_projectId_organizationId_fkey' AND connamespace = current_schema()::regnamespace) INTO missing;
  IF missing THEN
    ALTER TABLE "SelfInspectionAssignment" ADD CONSTRAINT "SelfInspectionAssignment_projectId_organizationId_fkey"
      FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionAssignment_taskId_organizationId_fkey' AND connamespace = current_schema()::regnamespace) INTO missing;
  IF missing THEN
    ALTER TABLE "SelfInspectionAssignment" ADD CONSTRAINT "SelfInspectionAssignment_taskId_organizationId_fkey"
      FOREIGN KEY ("taskId", "organizationId") REFERENCES "WorkflowTask"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCompetence_programId_organizationId_fkey' AND connamespace = current_schema()::regnamespace) INTO missing;
  IF missing THEN
    ALTER TABLE "SelfInspectionCompetence" ADD CONSTRAINT "SelfInspectionCompetence_programId_organizationId_fkey"
      FOREIGN KEY ("programId", "organizationId") REFERENCES "SelfInspectionProgram"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCompetence_organizationId_userId_fkey' AND connamespace = current_schema()::regnamespace) INTO missing;
  IF missing THEN
    ALTER TABLE "SelfInspectionCompetence" ADD CONSTRAINT "SelfInspectionCompetence_organizationId_userId_fkey"
      FOREIGN KEY ("organizationId", "userId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCustomerRequirement_programId_organizationId_fkey' AND connamespace = current_schema()::regnamespace) INTO missing;
  IF missing THEN
    ALTER TABLE "SelfInspectionCustomerRequirement" ADD CONSTRAINT "SelfInspectionCustomerRequirement_programId_organizationId_fkey"
      FOREIGN KEY ("programId", "organizationId") REFERENCES "SelfInspectionProgram"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCustomerRequirement_customerId_fkey' AND connamespace = current_schema()::regnamespace) INTO missing;
  IF missing THEN
    ALTER TABLE "SelfInspectionCustomerRequirement" ADD CONSTRAINT "SelfInspectionCustomerRequirement_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
