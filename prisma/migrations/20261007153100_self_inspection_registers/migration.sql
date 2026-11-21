-- Egenkontroll etapp 2–3 (2026-10-06): roles per assignment, customers' special requirements, competence cards,
-- the instrument register and the protocol row a deviation was taken from. Organisation data only (organizationId NOT
-- NULL, composite keys inside the company). Additive and safe to run again.

ALTER TABLE "SelfInspectionDeviation" ADD COLUMN IF NOT EXISTS "sourceTaskId" TEXT;
ALTER TABLE "SelfInspectionDeviation" ADD COLUMN IF NOT EXISTS "sourceTitle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SelfInspectionDeviation" ADD COLUMN IF NOT EXISTS "sourceRowId" TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS "SelfInspectionDeviation_organizationId_sourceTaskId_idx" ON "SelfInspectionDeviation"("organizationId", "sourceTaskId");

CREATE TABLE IF NOT EXISTS "SelfInspectionAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "performerUserId" TEXT,
    "inspectorUserId" TEXT,
    "activityType" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionAssignment_pkey" PRIMARY KEY ("id"),
    -- Exactly one of a project and a task.
    CONSTRAINT "SelfInspectionAssignment_one_target" CHECK (("projectId" IS NULL) <> ("taskId" IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "SelfInspectionAssignment_organizationId_projectId_key" ON "SelfInspectionAssignment"("organizationId", "projectId");
CREATE UNIQUE INDEX IF NOT EXISTS "SelfInspectionAssignment_organizationId_taskId_key" ON "SelfInspectionAssignment"("organizationId", "taskId");

CREATE TABLE IF NOT EXISTS "SelfInspectionCustomerRequirement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionCustomerRequirement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SelfInspectionCustomerRequirement_programId_customerId_key" ON "SelfInspectionCustomerRequirement"("programId", "customerId");
CREATE INDEX IF NOT EXISTS "SelfInspectionCustomerRequirement_organizationId_customerId_idx" ON "SelfInspectionCustomerRequirement"("organizationId", "customerId");

CREATE TABLE IF NOT EXISTS "SelfInspectionCredential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issuedAt" TEXT,
    "validUntil" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionCredential_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SelfInspectionCredential_organizationId_userId_idx" ON "SelfInspectionCredential"("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "SelfInspectionCredential_organizationId_validUntil_idx" ON "SelfInspectionCredential"("organizationId", "validUntil");

CREATE TABLE IF NOT EXISTS "Instrument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL DEFAULT '',
    "calibratedAt" TEXT,
    "nextCalibrationAt" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Instrument_organizationId_isActive_nextCalibrationAt_idx" ON "Instrument"("organizationId", "isActive", "nextCalibrationAt");

-- Keys keep every row inside its company: the project, task, programme and membership are referenced together with
-- the organisation.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionAssignment_organizationId_fkey') THEN
    ALTER TABLE "SelfInspectionAssignment" ADD CONSTRAINT "SelfInspectionAssignment_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionAssignment_projectId_organizationId_fkey') THEN
    ALTER TABLE "SelfInspectionAssignment" ADD CONSTRAINT "SelfInspectionAssignment_projectId_organizationId_fkey"
      FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionAssignment_taskId_organizationId_fkey') THEN
    ALTER TABLE "SelfInspectionAssignment" ADD CONSTRAINT "SelfInspectionAssignment_taskId_organizationId_fkey"
      FOREIGN KEY ("taskId", "organizationId") REFERENCES "WorkflowTask"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCustomerRequirement_programId_organizationId_fkey') THEN
    ALTER TABLE "SelfInspectionCustomerRequirement" ADD CONSTRAINT "SelfInspectionCustomerRequirement_programId_organizationId_fkey"
      FOREIGN KEY ("programId", "organizationId") REFERENCES "SelfInspectionProgram"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCustomerRequirement_customerId_fkey') THEN
    ALTER TABLE "SelfInspectionCustomerRequirement" ADD CONSTRAINT "SelfInspectionCustomerRequirement_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCredential_organizationId_userId_fkey') THEN
    ALTER TABLE "SelfInspectionCredential" ADD CONSTRAINT "SelfInspectionCredential_organizationId_userId_fkey"
      FOREIGN KEY ("organizationId", "userId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Instrument_organizationId_fkey') THEN
    ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- A customer's requirements must name a customer of the same company (the shared tenant check).
DROP TRIGGER IF EXISTS "SelfInspectionCustomerRequirement_customer_tenant" ON "SelfInspectionCustomerRequirement";
CREATE TRIGGER "SelfInspectionCustomerRequirement_customer_tenant" BEFORE INSERT OR UPDATE OF "customerId", "organizationId" ON "SelfInspectionCustomerRequirement"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_customer_tenant"();
