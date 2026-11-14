-- Börjar efter (projektförslaget steg 4, 2026-10-09): a job may start after other jobs in the same project
-- (finish-to-start). Additive only: every existing row gets an empty list. The ids are checked by the time plan route
-- (same project and company, no circle); at most 20 per job.
ALTER TABLE "WorkflowTask" ADD COLUMN "predecessorIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_predecessorIds_count"
  CHECK ("predecessorIds" IS NULL OR cardinality("predecessorIds") <= 20);
