-- Limit profiles and round schedules (2026-09-28, the form engine for recurring rounds). Additive only: two new tables,
-- no existing column changes. A limit profile holds a company's own limit values for one form family at one facility
-- (optionally per object there); a schedule says which form is filled in where and how often.
CREATE TABLE "FormLimitProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "objectName" TEXT NOT NULL DEFAULT '',
    "values" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT NOT NULL,
    "updatedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FormLimitProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FormLimitProfile_organizationId_templateId_facilityId_objectName_key" ON "FormLimitProfile"("organizationId", "templateId", "facilityId", "objectName");
CREATE INDEX "FormLimitProfile_organizationId_facilityId_idx" ON "FormLimitProfile"("organizationId", "facilityId");
ALTER TABLE "FormLimitProfile" ADD CONSTRAINT "FormLimitProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormLimitProfile" ADD CONSTRAINT "FormLimitProfile_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "CustomerFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FormSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customerId" TEXT,
    "facilityId" TEXT,
    "projectId" TEXT,
    "assignedToUserId" TEXT,
    "assignedToName" TEXT NOT NULL DEFAULT '',
    "rule" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FormSchedule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FormSchedule_organizationId_active_deletedAt_idx" ON "FormSchedule"("organizationId", "active", "deletedAt");
CREATE INDEX "FormSchedule_organizationId_facilityId_idx" ON "FormSchedule"("organizationId", "facilityId");
ALTER TABLE "FormSchedule" ADD CONSTRAINT "FormSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormSchedule" ADD CONSTRAINT "FormSchedule_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FormSchedule" ADD CONSTRAINT "FormSchedule_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "CustomerFacility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
