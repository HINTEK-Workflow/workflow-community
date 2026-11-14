-- Beslut 2026-10-27 (ersätter 2026-10-26 där de skiljer sig; docs/beslut/projekt-jobb-och-planering.md):
-- 1. Uppgifter får skapas först: a task may be saved as a draft without a work order – Planerad (or Utgår), never started
--    and never completed – but is linked to one before the work starts. The CHECK from 20261026120000_work_order_required
--    is loosened to exactly that; every other task still needs its work order, and a linked task is never let go (trigger).
-- 3. Arbetsordern håller driftronden: a work order holds a round for a period (roundScheduleId set, roundOccurrence empty,
--    plannedStartDate – dueDate), and every occurrence in the period is registered in it. The periods of one round's work
--    orders never overlap (a trigger, serialized per round). 0.24.0's work orders per occurrence (roundOccurrence = the day)
--    are kept as they are: no data is changed, merged or removed, and the unique key still holds for them.
-- Rapporterad från: WorkflowTimeEntry.sourceTaskId – the task the time was started or written in when it lands on the work
--    order, so a round occurrence keeps its own time. Additive (NULL for every existing row); a trigger requires the task to
--    be in the entry's work order.
-- Only constraints, triggers and one nullable column: nothing is rewritten, so production (0.24.0 data), kfid_v3_test and
-- the QA instances end up alike. Prisma does not manage triggers and CHECK, so they are no schema drift (as in
-- 20260925180000_tenant_hardening). All in one transaction.
--
-- Återgång i princip (no automatic down migration, as for the other migrations): link or remove the drafts without a work
-- order and end or remove the round work orders without roundOccurrence, then put back 20261026120000's two CHECKs, drop the
-- three triggers with their functions and the column sourceTaskId (with its index and key).

-- ---------- 1. Utkast utan arbetsorder ----------
ALTER TABLE "WorkflowTask" DROP CONSTRAINT "WorkflowTask_work_order_required_check";
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_work_order_required_check" CHECK (
  "kind" = 'WORK_ORDER' OR "workOrderId" IS NOT NULL
  OR ("status" IN ('PLANNED', 'CANCELLED') AND "startedAt" IS NULL AND "completedAt" IS NULL)
);

-- A linked task may move to another work order but is never let go (the route says why; this is the database's word).
CREATE OR REPLACE FUNCTION "workflow_keep_work_order"() RETURNS trigger AS $$
BEGIN
  IF OLD."workOrderId" IS NOT NULL AND NEW."workOrderId" IS NULL AND NEW."kind" <> 'WORK_ORDER' THEN
    RAISE EXCEPTION 'Uppgiften ligger i en arbetsorder och kan inte tas ur den.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WorkflowTask_keep_work_order" BEFORE UPDATE OF "workOrderId" ON "WorkflowTask"
  FOR EACH ROW EXECUTE FUNCTION "workflow_keep_work_order"();

-- ---------- 2. Arbetsordern som håller ronden ----------
ALTER TABLE "WorkflowTask" DROP CONSTRAINT "WorkflowTask_round_key_check";
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_round_key_check" CHECK (
  ("roundScheduleId" IS NULL AND "roundOccurrence" IS NULL)
  -- 0.24.0: a work order for one occurrence.
  -- (IS NOT NULL first: a NULL here would make the whole CHECK NULL, and a NULL CHECK lets the row through.)
  OR ("kind" = 'WORK_ORDER' AND "roundScheduleId" IS NOT NULL AND "roundOccurrence" IS NOT NULL AND "roundOccurrence" ~'^\d{4}-\d{2}-\d{2}$')
  -- Since 2026-10-27: the round's work order for its period.
  OR ("kind" = 'WORK_ORDER' AND "roundScheduleId" IS NOT NULL AND "roundOccurrence" IS NULL
      AND "plannedStartDate" ~ '^\d{4}-\d{2}-\d{2}$' AND "dueDate" ~ '^\d{4}-\d{2}-\d{2}$' AND "plannedStartDate" <= "dueDate")
);

CREATE OR REPLACE FUNCTION "workflow_assert_round_period"() RETURNS trigger AS $$
BEGIN
  -- One check at a time per round, so two work orders saved at the same moment cannot both pass.
  PERFORM pg_advisory_xact_lock(hashtext('workflow-round-period:' || NEW."roundScheduleId"));
  IF EXISTS (
    SELECT 1 FROM "WorkflowTask" o
    WHERE o."organizationId" = NEW."organizationId" AND o."roundScheduleId" = NEW."roundScheduleId" AND o."roundOccurrence" IS NULL
      AND o."status" <> 'CANCELLED' AND o."id" <> NEW."id"
      AND o."plannedStartDate" <= NEW."dueDate" AND NEW."plannedStartDate" <= o."dueDate"
  ) THEN
    RAISE EXCEPTION 'Ronden har redan en arbetsorder för en del av perioden. Perioderna får inte gå omlott.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WorkflowTask_round_period" BEFORE INSERT OR UPDATE OF "roundScheduleId", "roundOccurrence", "plannedStartDate", "dueDate", "status" ON "WorkflowTask"
  FOR EACH ROW WHEN (NEW."roundScheduleId" IS NOT NULL AND NEW."roundOccurrence" IS NULL AND NEW."status" <> 'CANCELLED')
  EXECUTE FUNCTION "workflow_assert_round_period"();

-- ---------- 3. Tid rapporterad från en uppgift ----------
ALTER TABLE "WorkflowTimeEntry" ADD COLUMN "sourceTaskId" TEXT;
CREATE INDEX "WorkflowTimeEntry_sourceTaskId_idx" ON "WorkflowTimeEntry"("sourceTaskId");
ALTER TABLE "WorkflowTimeEntry" ADD CONSTRAINT "WorkflowTimeEntry_sourceTaskId_fkey"
  FOREIGN KEY ("sourceTaskId") REFERENCES "WorkflowTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "workflow_assert_time_source"() RETURNS trigger AS $$
BEGIN
  IF NEW."sourceTaskId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."sourceTaskId" IS DISTINCT FROM OLD."sourceTaskId" OR NEW."taskId" IS DISTINCT FROM OLD."taskId") THEN
    IF NEW."taskId" IS NULL OR NOT EXISTS (SELECT 1 FROM "WorkflowTask" WHERE "id" = NEW."sourceTaskId" AND "kind" <> 'WORK_ORDER' AND "workOrderId" = NEW."taskId") THEN
      RAISE EXCEPTION 'Tiden kan bara vara rapporterad från en uppgift i samma arbetsorder.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WorkflowTimeEntry_source_in_order" BEFORE INSERT OR UPDATE OF "sourceTaskId", "taskId" ON "WorkflowTimeEntry"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_time_source"();
