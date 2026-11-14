ALTER TABLE "Project" ADD COLUMN "timeBudgetMinutes" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "PlannedActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "workflowTaskId" TEXT,
    "controlId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'TASK',
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "assignedToUserId" TEXT,
    "assignedToName" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlannedActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlannedActivityEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plannedActivityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorName" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlannedActivityEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlannedActivity_id_organizationId_key" ON "PlannedActivity"("id", "organizationId");
CREATE INDEX "PlannedActivity_organizationId_startsAt_endsAt_idx" ON "PlannedActivity"("organizationId", "startsAt", "endsAt");
CREATE INDEX "PlannedActivity_organizationId_projectId_startsAt_idx" ON "PlannedActivity"("organizationId", "projectId", "startsAt");
CREATE INDEX "PlannedActivity_organizationId_workflowTaskId_startsAt_idx" ON "PlannedActivity"("organizationId", "workflowTaskId", "startsAt");
CREATE INDEX "PlannedActivity_organizationId_controlId_startsAt_idx" ON "PlannedActivity"("organizationId", "controlId", "startsAt");
CREATE INDEX "PlannedActivity_organizationId_assignedToUserId_startsAt_idx" ON "PlannedActivity"("organizationId", "assignedToUserId", "startsAt");
CREATE INDEX "PlannedActivityEvent_organizationId_plannedActivityId_createdAt_idx" ON "PlannedActivityEvent"("organizationId", "plannedActivityId", "createdAt");

ALTER TABLE "PlannedActivity" ADD CONSTRAINT "PlannedActivity_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlannedActivity" ADD CONSTRAINT "PlannedActivity_projectId_organizationId_fkey"
FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlannedActivity" ADD CONSTRAINT "PlannedActivity_workflowTaskId_organizationId_fkey"
FOREIGN KEY ("workflowTaskId", "organizationId") REFERENCES "WorkflowTask"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlannedActivity" ADD CONSTRAINT "PlannedActivity_controlId_organizationId_fkey"
FOREIGN KEY ("controlId", "organizationId") REFERENCES "Control"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlannedActivityEvent" ADD CONSTRAINT "PlannedActivityEvent_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlannedActivityEvent" ADD CONSTRAINT "PlannedActivityEvent_plannedActivityId_organizationId_fkey"
FOREIGN KEY ("plannedActivityId", "organizationId") REFERENCES "PlannedActivity"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
