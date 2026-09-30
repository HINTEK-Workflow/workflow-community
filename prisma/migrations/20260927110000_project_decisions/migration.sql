-- The project's decision log (Daniel 2026-09-26): append-only, tenant-bound through the composite project key.
CREATE TABLE "ProjectDecision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "decidedOn" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "actorName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectDecision_organizationId_projectId_decidedOn_idx" ON "ProjectDecision"("organizationId", "projectId", "decidedOn");

ALTER TABLE "ProjectDecision" ADD CONSTRAINT "ProjectDecision_projectId_organizationId_fkey"
FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
