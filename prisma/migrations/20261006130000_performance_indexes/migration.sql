-- Quality check 2026-10-05 (docs/proposals/kvalitetskontroll-20261005.md).
--
-- The place page and the customer card read tasks, controls and projects by facilityId IN (…); without an index they
-- read every row of the company. "Mina" in the work list filters tasks by the assignee.
-- The planned-time lookup of /api/work-items uses the existing (organizationId, workflowTaskId, startsAt) index now
-- that the query carries organizationId; it needs no new index.
CREATE INDEX IF NOT EXISTS "Project_organizationId_facilityId_idx" ON "Project"("organizationId", "facilityId");
CREATE INDEX IF NOT EXISTS "WorkflowTask_organizationId_facilityId_idx" ON "WorkflowTask"("organizationId", "facilityId");
CREATE INDEX IF NOT EXISTS "WorkflowTask_organizationId_assignedToUserId_idx" ON "WorkflowTask"("organizationId", "assignedToUserId");
CREATE INDEX IF NOT EXISTS "Control_organizationId_facilityId_idx" ON "Control"("organizationId", "facilityId");
