-- Rapportarkiv (2026-10-07): a PDF or Excel report a person chose to keep when exporting. The file is in the
-- ordinary storage; the row says what it reports, who made it and which permission area may read it. Organisation data
-- only (organizationId NOT NULL). No foreign key to the task or project: the report outlives them. Additive and safe to
-- run again.

CREATE TABLE IF NOT EXISTS "ReportArchiveEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "taskId" TEXT,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportArchiveEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ReportArchiveEntry_storagePath_key" ON "ReportArchiveEntry"("storagePath");
CREATE INDEX IF NOT EXISTS "ReportArchiveEntry_organizationId_createdAt_idx" ON "ReportArchiveEntry"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ReportArchiveEntry_organizationId_createdById_createdAt_idx" ON "ReportArchiveEntry"("organizationId", "createdById", "createdAt");
CREATE INDEX IF NOT EXISTS "ReportArchiveEntry_organizationId_taskId_idx" ON "ReportArchiveEntry"("organizationId", "taskId");
