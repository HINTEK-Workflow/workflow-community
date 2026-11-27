-- Tidplan (Gantt v1, 2026-10-09): a job gets a planned start and an estimated work time. "Klart senast"
-- (dueDate) stays the end of the job's period. Additive only: every existing row gets '' / NULL and is shown under
-- "Utan datum" until someone plans it. Nothing is rewritten or deleted.
ALTER TABLE "WorkflowTask" ADD COLUMN "plannedStartDate" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WorkflowTask" ADD COLUMN "estimatedMinutes" INTEGER;
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_plannedStartDate_format"
  CHECK ("plannedStartDate" = '' OR "plannedStartDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_estimatedMinutes_range"
  CHECK ("estimatedMinutes" IS NULL OR ("estimatedMinutes" >= 0 AND "estimatedMinutes" <= 600000));
