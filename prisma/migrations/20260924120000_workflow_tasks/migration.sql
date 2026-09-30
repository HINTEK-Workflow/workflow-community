ALTER TABLE "Project" ADD COLUMN "taskTypes" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Project" ADD COLUMN "workMoments" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "WorkflowTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "customerId" TEXT,
    "siteId" TEXT,
    "departmentId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "assignedToUserId" TEXT,
    "assignedToName" TEXT NOT NULL DEFAULT '',
    "dueDate" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkflowTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowTaskRevision" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowTaskRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowTimeEntry" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkflowTimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowTask_id_organizationId_key" ON "WorkflowTask"("id", "organizationId");
CREATE INDEX "WorkflowTask_organizationId_kind_status_updatedAt_idx" ON "WorkflowTask"("organizationId", "kind", "status", "updatedAt");
CREATE INDEX "WorkflowTask_organizationId_projectId_status_idx" ON "WorkflowTask"("organizationId", "projectId", "status");
CREATE INDEX "WorkflowTask_organizationId_customerId_idx" ON "WorkflowTask"("organizationId", "customerId");
CREATE INDEX "WorkflowTask_organizationId_siteId_departmentId_idx" ON "WorkflowTask"("organizationId", "siteId", "departmentId");
CREATE UNIQUE INDEX "WorkflowTaskRevision_taskId_version_key" ON "WorkflowTaskRevision"("taskId", "version");
CREATE INDEX "WorkflowTaskRevision_taskId_createdAt_idx" ON "WorkflowTaskRevision"("taskId", "createdAt");
CREATE INDEX "WorkflowTimeEntry_taskId_startedAt_idx" ON "WorkflowTimeEntry"("taskId", "startedAt");
CREATE INDEX "WorkflowTimeEntry_userId_startedAt_idx" ON "WorkflowTimeEntry"("userId", "startedAt");

ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_siteId_organizationId_fkey" FOREIGN KEY ("siteId", "organizationId") REFERENCES "Site"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_departmentId_siteId_organizationId_fkey" FOREIGN KEY ("departmentId", "siteId", "organizationId") REFERENCES "Department"("id", "siteId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowTaskRevision" ADD CONSTRAINT "WorkflowTaskRevision_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkflowTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowTimeEntry" ADD CONSTRAINT "WorkflowTimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkflowTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
