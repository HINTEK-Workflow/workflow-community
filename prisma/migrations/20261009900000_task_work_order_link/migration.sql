-- Hör till arbetsorder (Fas 2, 2026-10-08): a task (protocol, control, risk assessment) can belong to one work
-- order in the same company, and its time is then recorded on the work order (the job).
--
-- 1. Checks first. The column is new, so no existing row can point anywhere; the check only matters if this file is run
--    again by hand after the column was added: a link into another organization, to something that is not a work order,
--    from a work order, or to itself stops the migration with the counts. Nothing is deleted or rewritten here.
-- 2. The column with a composite foreign key [workOrderId, organizationId] -> [id, organizationId] (the pattern of
--    20261009200000_tenant_composite_relations). NO ACTION (checked at the end of the statement): deleting a company
--    removes all its tasks in one statement; deleting a single work order unlinks its tasks first (the route).
-- 3. A trigger for what a key cannot express: the target is a WORK_ORDER, never the task itself, and a work order does
--    not belong to another work order. It checks only when the link (or the kind or company) changes, so existing rows
--    are never tripped.
-- Prisma does not manage triggers, so they are not schema drift (same convention as 20260925180000_tenant_hardening).

-- ---------- 1. Pre-check ----------
DO $$
DECLARE
  other_organization INT := 0;
  not_work_order INT := 0;
  from_work_order INT := 0;
  to_itself INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'WorkflowTask' AND column_name = 'workOrderId') THEN
    EXECUTE 'SELECT count(*) FROM "WorkflowTask" t JOIN "WorkflowTask" w ON w."id" = t."workOrderId" WHERE w."organizationId" <> t."organizationId"' INTO other_organization;
    EXECUTE 'SELECT count(*) FROM "WorkflowTask" t JOIN "WorkflowTask" w ON w."id" = t."workOrderId" WHERE w."kind" <> ''WORK_ORDER''' INTO not_work_order;
    EXECUTE 'SELECT count(*) FROM "WorkflowTask" t WHERE t."workOrderId" IS NOT NULL AND t."kind" = ''WORK_ORDER''' INTO from_work_order;
    EXECUTE 'SELECT count(*) FROM "WorkflowTask" t WHERE t."workOrderId" = t."id"' INTO to_itself;
  END IF;
  IF other_organization + not_work_order + from_work_order + to_itself > 0 THEN
    RAISE EXCEPTION 'Task work order links: rows break the rules – nothing was changed. Into another organization=%, target not a work order=%, work order linked to a work order=%, linked to itself=%. Investigate these rows by hand.',
      other_organization, not_work_order, from_work_order, to_itself
      USING ERRCODE = '23503';
  END IF;
END $$;

-- ---------- 2. Column and composite foreign key ----------
ALTER TABLE "WorkflowTask" ADD COLUMN "workOrderId" TEXT;

CREATE INDEX "WorkflowTask_organizationId_workOrderId_idx" ON "WorkflowTask"("organizationId", "workOrderId");

ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_workOrderId_organizationId_fkey"
  FOREIGN KEY ("workOrderId", "organizationId") REFERENCES "WorkflowTask"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------- 3. Trigger ----------
CREATE OR REPLACE FUNCTION "workflow_assert_task_work_order"() RETURNS trigger AS $$
BEGIN
  IF NEW."workOrderId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."workOrderId" IS DISTINCT FROM OLD."workOrderId"
      OR NEW."kind" IS DISTINCT FROM OLD."kind" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId") THEN
    IF NEW."kind" = 'WORK_ORDER' THEN
      RAISE EXCEPTION 'En arbetsorder kan inte höra till en annan arbetsorder.' USING ERRCODE = '23514';
    END IF;
    IF NEW."workOrderId" = NEW."id" THEN
      RAISE EXCEPTION 'En uppgift kan inte höra till sig själv.' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "WorkflowTask" WHERE "id" = NEW."workOrderId" AND "organizationId" = NEW."organizationId" AND "kind" = 'WORK_ORDER'
    ) THEN
      RAISE EXCEPTION 'Arbetsordern hittades inte i samma organisation.' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WorkflowTask_work_order_link" BEFORE INSERT OR UPDATE OF "workOrderId", "kind", "organizationId" ON "WorkflowTask"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_task_work_order"();
