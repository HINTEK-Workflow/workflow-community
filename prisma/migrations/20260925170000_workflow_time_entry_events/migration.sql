CREATE TABLE "WorkflowTimeEntryEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previous" JSONB,
    "next" JSONB,
    "reason" TEXT NOT NULL DEFAULT '',
    "actorUserId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowTimeEntryEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkflowTimeEntryEvent_action_check" CHECK ("action" IN ('CREATED', 'UPDATED', 'DELETED'))
);

CREATE INDEX "WorkflowTimeEntryEvent_organizationId_entryId_createdAt_idx" ON "WorkflowTimeEntryEvent"("organizationId", "entryId", "createdAt");
CREATE INDEX "WorkflowTimeEntryEvent_organizationId_userId_createdAt_idx" ON "WorkflowTimeEntryEvent"("organizationId", "userId", "createdAt");

ALTER TABLE "WorkflowTimeEntryEvent" ADD CONSTRAINT "WorkflowTimeEntryEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
