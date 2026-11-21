ALTER TABLE "Project"
ADD COLUMN "responsibleUserId" TEXT,
ADD COLUMN "responsibleName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE TABLE "ProjectEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "taskId" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectEvent_organizationId_projectId_createdAt_idx"
ON "ProjectEvent"("organizationId", "projectId", "createdAt");

ALTER TABLE "ProjectEvent"
ADD CONSTRAINT "ProjectEvent_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ProjectEvent" ("id", "organizationId", "projectId", "kind", "summary", "createdBy", "createdAt")
SELECT CONCAT('project_created_', "id"), "organizationId", "id", 'CREATED', 'Projektet skapades', "createdBy", "createdAt"
FROM "Project";
