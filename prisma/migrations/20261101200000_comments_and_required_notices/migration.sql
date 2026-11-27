-- Kommentarer (beslut 14, 2026-11-01): one thread per work order, project and deviation. Exactly one parent is set, and each
-- parent goes through the composite key, so the database refuses a comment on another company's row. The thread goes with
-- its parent. Notiser (beslut 4): "Kräver åtgärd" goes by e-mail and push from the start, with the person's own way out.
-- Additive only: the old app never reads the new table or column.

BEGIN;

ALTER TABLE "NoticePreference" ADD COLUMN "requiredNotices" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowTaskId" TEXT,
    "projectId" TEXT,
    "deviationId" TEXT,
    "authorUserId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "inCustomerReport" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Comment_one_parent_check" CHECK (num_nonnulls("workflowTaskId", "projectId", "deviationId") = 1)
);

CREATE INDEX "Comment_organizationId_workflowTaskId_createdAt_idx" ON "Comment"("organizationId", "workflowTaskId", "createdAt");
CREATE INDEX "Comment_organizationId_projectId_createdAt_idx" ON "Comment"("organizationId", "projectId", "createdAt");
CREATE INDEX "Comment_organizationId_deviationId_createdAt_idx" ON "Comment"("organizationId", "deviationId", "createdAt");
CREATE INDEX "Comment_authorUserId_idx" ON "Comment"("authorUserId");

ALTER TABLE "Comment" ADD CONSTRAINT "Comment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_workflowTaskId_organizationId_fkey" FOREIGN KEY ("workflowTaskId", "organizationId") REFERENCES "WorkflowTask"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_deviationId_organizationId_fkey" FOREIGN KEY ("deviationId", "organizationId") REFERENCES "SelfInspectionDeviation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
