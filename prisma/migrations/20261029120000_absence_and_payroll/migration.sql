-- Frånvaro och lön (2026-10-29, docs/integrationer/franvaro-och-lon.md): absence for Cloud (lib/workflow/absence.ts),
-- its history, the company's payroll/HR integration settings, the import and export history, and the employee number on the
-- membership. Additive only: four new tables and one nullable column; nothing existing is changed or deleted. Only the type
-- of an absence is stored, never a diagnosis. Secrets (SFTP password or key, API key) are company keys (IntegrationKey,
-- sealed per company), never in these tables.
-- Its own transaction: Prisma runs a file statement by statement (tests/migration-interrupted.integration.ts).
BEGIN;

ALTER TABLE "OrganizationMember" ADD COLUMN "employeeNumber" TEXT;
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_employeeNumber_check" CHECK ("employeeNumber" IS NULL OR char_length("employeeNumber") BETWEEN 1 AND 40);
CREATE UNIQUE INDEX "OrganizationMember_organizationId_employeeNumber_key" ON "OrganizationMember"("organizationId", "employeeNumber");

CREATE TABLE "Absence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalSystem" TEXT,
    "externalKey" TEXT,
    "externalCode" TEXT,
    "externalHash" TEXT,
    "importRunId" TEXT,
    "handled" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Absence_type_check" CHECK ("type" IN ('SICK', 'VAB', 'VACATION', 'LEAVE', 'COMP', 'FLEX', 'TRAINING', 'PARENTAL', 'OTHER')),
    CONSTRAINT "Absence_status_check" CHECK ("status" IN ('APPLIED', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
    CONSTRAINT "Absence_source_check" CHECK ("source" IN ('MANUAL', 'FILE', 'SFTP', 'API')),
    CONSTRAINT "Absence_dates_check" CHECK ("fromDate" ~ '^\d{4}-\d{2}-\d{2}$' AND "toDate" ~ '^\d{4}-\d{2}-\d{2}$' AND "fromDate" <= "toDate"),
    CONSTRAINT "Absence_hours_check" CHECK (("startTime" IS NULL AND "endTime" IS NULL) OR ("startTime" ~ '^\d{2}:\d{2}$' AND "endTime" ~ '^\d{2}:\d{2}$' AND "startTime" < "endTime" AND "fromDate" = "toDate")),
    CONSTRAINT "Absence_note_check" CHECK (char_length("note") <= 120),
    CONSTRAINT "Absence_external_check" CHECK (("source" = 'MANUAL') = ("externalKey" IS NULL))
);
CREATE UNIQUE INDEX "Absence_organizationId_externalSystem_externalKey_key" ON "Absence"("organizationId", "externalSystem", "externalKey");
CREATE INDEX "Absence_organizationId_userId_fromDate_idx" ON "Absence"("organizationId", "userId", "fromDate");
CREATE INDEX "Absence_organizationId_toDate_idx" ON "Absence"("organizationId", "toDate");
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Composite: the person is always a member of the absence's own company.
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AbsenceEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "absenceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbsenceEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AbsenceEvent_detail_check" CHECK (char_length("detail") <= 300)
);
CREATE INDEX "AbsenceEvent_organizationId_absenceId_createdAt_idx" ON "AbsenceEvent"("organizationId", "absenceId", "createdAt");
CREATE INDEX "AbsenceEvent_organizationId_createdAt_idx" ON "AbsenceEvent"("organizationId", "createdAt");
ALTER TABLE "AbsenceEvent" ADD CONSTRAINT "AbsenceEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PayrollIntegration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "system" TEXT NOT NULL DEFAULT 'none',
    "systemName" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT 'manual',
    "importedEditable" BOOLEAN NOT NULL DEFAULT false,
    "codeMap" JSONB NOT NULL DEFAULT '{}',
    "exportCodes" JSONB NOT NULL DEFAULT '{}',
    "importTemplates" JSONB NOT NULL DEFAULT '[]',
    "exportTemplates" JSONB NOT NULL DEFAULT '[]',
    "sftp" JSONB NOT NULL DEFAULT '{}',
    "lastImportAt" TIMESTAMP(3),
    "lastExportAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollIntegration_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayrollIntegration_system_check" CHECK ("system" IN ('none', 'flex_hrm', 'fortnox', 'spiris', 'visma', 'other')),
    CONSTRAINT "PayrollIntegration_mode_check" CHECK ("mode" IN ('manual', 'sftp', 'api')),
    CONSTRAINT "PayrollIntegration_json_check" CHECK (octet_length("codeMap"::text) + octet_length("exportCodes"::text) + octet_length("importTemplates"::text) + octet_length("exportTemplates"::text) + octet_length("sftp"::text) <= 131072)
);
CREATE UNIQUE INDEX "PayrollIntegration_organizationId_key" ON "PayrollIntegration"("organizationId");
ALTER TABLE "PayrollIntegration" ADD CONSTRAINT "PayrollIntegration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "IntegrationRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "system" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IntegrationRun_direction_check" CHECK ("direction" IN ('import', 'export')),
    CONSTRAINT "IntegrationRun_mode_check" CHECK ("mode" IN ('manual', 'sftp', 'api')),
    CONSTRAINT "IntegrationRun_status_check" CHECK ("status" IN ('ok', 'partial', 'failed')),
    CONSTRAINT "IntegrationRun_errors_check" CHECK (octet_length("errors"::text) <= 65536)
);
CREATE INDEX "IntegrationRun_organizationId_createdAt_idx" ON "IntegrationRun"("organizationId", "createdAt");
CREATE INDEX "IntegrationRun_organizationId_direction_contentHash_idx" ON "IntegrationRun"("organizationId", "direction", "contentHash");
ALTER TABLE "IntegrationRun" ADD CONSTRAINT "IntegrationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
