-- Arbetsordern styr (2026-10-26, docs/proposals/arbetsorder-styr-2026-10-26.md med svaren 1a 2b 3b 4b 5a):
-- en uppgift (protokoll, kontroll, riskbedömning) kan inte finnas utan arbetsorder, tid rapporteras bara på en arbetsorder
-- eller ett projekt, och varje tillfälle av en driftrond har en egen arbetsorder. All data hittills är testdata, men
-- migreringen är ren och ger samma resultat i produktion, kfid_v3_test och QA-instanserna. Allt i en transaktion.
--
-- 1. Additivt: WorkflowTimeEntry.projectId (projekttid), WorkflowTask.roundScheduleId/roundOccurrence (rondens arbetsorder).
-- 2. Data: varje fristående uppgift får en ny arbetsorder som omsluter den (deterministiskt id 'wo_' || uppgiftens id) med
--    uppgiftens rubrik, projekt, kund, plats, ansvarig, datum, status och risksteg. Uppgiften får bara workOrderId satt –
--    en kolumn, ingen ny version och inget ändrat innehåll, så färdigställda och signerade protokoll är orörda. Tidrader på
--    uppgifter (fristående och äldre tid på kopplade uppgifter) flyttas till arbetsordern med en rad i tidshistoriken, och
--    bokningar (PlannedActivity.workflowTaskId) likaså. Ett rondprotokoll ger rondens arbetsorder för sitt tillfälle.
-- 3. Regler i databasen: CHECK att varje uppgift som inte är en arbetsorder har workOrderId, CHECK att en tidrad har exakt
--    en ägare (uppgift/arbetsorder, projekt eller den frysta kontrollen), en trigger som kräver att en tidrads taskId är en
--    WORK_ORDER, och CHECK att rondnyckeln bara finns på arbetsordrar.
-- Prisma hanterar inte triggers och CHECK, så de är ingen schemadrift (samma konvention som 20260925180000_tenant_hardening).
--
-- Återgång i princip (ingen automatisk nedmigrering, som i övriga migreringar): ta bort triggern och de tre CHECK-villkoren,
-- återställ WorkflowTimeEntry_one_owner_check till ("taskId" IS NULL) <> ("controlId" IS NULL) efter att projekttid flyttats
-- eller tagits bort, flytta tidrader och bokningar från 'wo_'-arbetsordrarna tillbaka till uppgiften (händelseraderna med
-- skälet nedan visar varifrån), sätt workOrderId = NULL på uppgifter vars arbetsorder har id 'wo_' || uppgiftens id, ta bort
-- de arbetsordrarna och till sist kolumnerna.

-- ---------- 1. Kolumner ----------
ALTER TABLE "WorkflowTimeEntry" ADD COLUMN "projectId" TEXT;
CREATE INDEX "WorkflowTimeEntry_projectId_startedAt_idx" ON "WorkflowTimeEntry"("projectId", "startedAt");
ALTER TABLE "WorkflowTimeEntry" ADD CONSTRAINT "WorkflowTimeEntry_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowTask" ADD COLUMN "roundScheduleId" TEXT, ADD COLUMN "roundOccurrence" TEXT;
CREATE UNIQUE INDEX "WorkflowTask_organizationId_roundScheduleId_roundOccurrence_key" ON "WorkflowTask"("organizationId", "roundScheduleId", "roundOccurrence");
-- NO ACTION: a round is only soft-deleted (deletedAt); a whole company is removed in one statement.
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_roundScheduleId_organizationId_fkey"
  FOREIGN KEY ("roundScheduleId", "organizationId") REFERENCES "FormSchedule"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------- 2. Fristående uppgifter in i var sin arbetsorder ----------
CREATE TEMP TABLE "_wrap" ON COMMIT DROP AS
SELECT t."id" AS "taskId", 'wo_' || t."id" AS "orderId", t."organizationId", t."title", t."status", t."createdAt", t."createdBy",
  -- The round the protocol was started from (values.round), when the schedule is the company's own.
  CASE WHEN s."id" IS NOT NULL THEN s."id" END AS "scheduleId",
  CASE WHEN s."id" IS NOT NULL AND (t."data"->'details'->'values'->'round'->>'occurrence') ~ '^\d{4}-\d{2}-\d{2}$'
    THEN t."data"->'details'->'values'->'round'->>'occurrence' END AS "occurrence"
FROM "WorkflowTask" t
LEFT JOIN "FormSchedule" s ON s."id" = t."data"->'details'->'values'->'round'->>'scheduleId' AND s."organizationId" = t."organizationId"
WHERE t."kind" <> 'WORK_ORDER' AND t."workOrderId" IS NULL;

-- One work order per occurrence: when several protocols were started for the same day, the first one's order carries the key.
UPDATE "_wrap" w SET "scheduleId" = NULL, "occurrence" = NULL
WHERE w."occurrence" IS NULL OR EXISTS (
  SELECT 1 FROM "_wrap" o WHERE o."organizationId" = w."organizationId" AND o."scheduleId" = w."scheduleId" AND o."occurrence" = w."occurrence"
    AND (o."createdAt", o."taskId") < (w."createdAt", w."taskId")
);

INSERT INTO "WorkflowTask" ("id", "organizationId", "projectId", "customerId", "facilityId", "kind", "title", "description", "status", "progress",
  "assignedToUserId", "assignedToName", "dueDate", "plannedStartDate", "estimatedMinutes", "stage", "data", "version", "startedAt", "completedAt",
  "cancelledAt", "cancelledBy", "cancelReason", "cancelledFromStatus", "createdBy", "updatedBy", "createdAt", "updatedAt", "roundScheduleId", "roundOccurrence")
SELECT w."orderId", t."organizationId", t."projectId", t."customerId", t."facilityId", 'WORK_ORDER', t."title", '', t."status",
  CASE WHEN t."status" = 'COMPLETED' THEN 100 ELSE 0 END,
  t."assignedToUserId", t."assignedToName", t."dueDate", t."plannedStartDate", t."estimatedMinutes", t."stage",
  jsonb_build_object('kind', 'WORK_ORDER', 'details', jsonb_build_object('executionNotes', '', 'deviations', '', 'materials', '[]'::jsonb,
      'signature', jsonb_build_object('name', '', 'confirmed', false, 'signedAt', NULL), 'closeNotes', ''))
    -- The risk step moves to the work order (the task inherits it from now on); the temporary place comes along.
    || CASE WHEN t."data" ? 'riskStep' THEN jsonb_build_object('riskStep', t."data"->'riskStep') ELSE '{}'::jsonb END
    || CASE WHEN t."data" ? 'riskCheck' THEN jsonb_build_object('riskCheck', t."data"->'riskCheck') ELSE '{}'::jsonb END
    || CASE WHEN t."data" ? 'tempPlace' THEN jsonb_build_object('tempPlace', t."data"->'tempPlace') ELSE '{}'::jsonb END,
  1, t."startedAt", t."completedAt", t."cancelledAt", t."cancelledBy", t."cancelReason", t."cancelledFromStatus",
  t."createdBy", t."createdBy", t."createdAt", CURRENT_TIMESTAMP, w."scheduleId", w."occurrence"
FROM "_wrap" w JOIN "WorkflowTask" t ON t."id" = w."taskId";

INSERT INTO "WorkflowTaskRevision" ("id", "taskId", "version", "snapshot", "createdBy", "createdAt")
SELECT w."orderId" || '_r1', w."orderId", 1,
  jsonb_build_object('title', o."title", 'description', '', 'status', o."status", 'progress', o."progress", 'data', o."data", 'completedAt', o."completedAt",
    'note', 'Arbetsorder skapad runt uppgiften (modellbyte 2026-10-26)'),
  w."createdBy", CURRENT_TIMESTAMP
FROM "_wrap" w JOIN "WorkflowTask" o ON o."id" = w."orderId";

UPDATE "WorkflowTask" t SET "workOrderId" = w."orderId" FROM "_wrap" w WHERE t."id" = w."taskId";

-- Time on tasks moves to their work order: the wrapped ones and older entries on tasks that already had an order. Finished
-- entries get a row in the append-only time history (a running entry enters it when it stops, on the work order).
INSERT INTO "WorkflowTimeEntryEvent" ("id", "organizationId", "entryId", "userId", "action", "previous", "next", "reason", "actorUserId", "actorName", "createdAt")
SELECT 'wom_' || e."id", t."organizationId", e."id", e."userId", 'UPDATED',
  jsonb_build_object('taskId', t."id", 'taskTitle', t."title", 'startedAt', to_char(e."startedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'endedAt', to_char(e."endedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'durationSec', e."durationSec", 'note', e."note"),
  jsonb_build_object('taskId', o."id", 'taskTitle', o."title", 'startedAt', to_char(e."startedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'endedAt', to_char(e."endedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'durationSec', e."durationSec", 'note', e."note"),
  'Flyttad till arbetsorder (modellbyte 2026-10-26)', 'system:model-change', 'Workflow', CURRENT_TIMESTAMP
FROM "WorkflowTimeEntry" e
JOIN "WorkflowTask" t ON t."id" = e."taskId" AND t."kind" <> 'WORK_ORDER'
JOIN "WorkflowTask" o ON o."id" = t."workOrderId"
WHERE e."endedAt" IS NOT NULL;

UPDATE "WorkflowTimeEntry" e SET "taskId" = t."workOrderId"
FROM "WorkflowTask" t WHERE t."id" = e."taskId" AND t."kind" <> 'WORK_ORDER' AND t."workOrderId" IS NOT NULL;

-- Bookings follow: a booking is on a work order or a project.
UPDATE "PlannedActivity" a SET "workflowTaskId" = t."workOrderId", "projectId" = COALESCE(a."projectId", t."projectId")
FROM "WorkflowTask" t WHERE t."id" = a."workflowTaskId" AND t."organizationId" = a."organizationId" AND t."kind" <> 'WORK_ORDER' AND t."workOrderId" IS NOT NULL;

-- ---------- 3. Regler ----------
DO $$
DECLARE
  unlinked INT;
  time_on_task INT;
BEGIN
  SELECT count(*) INTO unlinked FROM "WorkflowTask" WHERE "kind" <> 'WORK_ORDER' AND "workOrderId" IS NULL;
  SELECT count(*) INTO time_on_task FROM "WorkflowTimeEntry" e JOIN "WorkflowTask" t ON t."id" = e."taskId" WHERE t."kind" <> 'WORK_ORDER';
  IF unlinked + time_on_task > 0 THEN
    RAISE EXCEPTION 'Arbetsordern styr: rows break the rules after the move – nothing was changed. Tasks without work order=%, time on a task=%.', unlinked, time_on_task
      USING ERRCODE = '23514';
  END IF;
END $$;

ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_work_order_required_check" CHECK ("kind" = 'WORK_ORDER' OR "workOrderId" IS NOT NULL);
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_round_key_check" CHECK (
  ("roundScheduleId" IS NULL AND "roundOccurrence" IS NULL)
  OR ("kind" = 'WORK_ORDER' AND "roundScheduleId" IS NOT NULL AND "roundOccurrence" ~ '^\d{4}-\d{2}-\d{2}$')
);

ALTER TABLE "WorkflowTimeEntry" DROP CONSTRAINT "WorkflowTimeEntry_one_owner_check";
ALTER TABLE "WorkflowTimeEntry" ADD CONSTRAINT "WorkflowTimeEntry_one_owner_check" CHECK (num_nonnulls("taskId", "controlId", "projectId") = 1);

CREATE OR REPLACE FUNCTION "workflow_assert_time_on_work_order"() RETURNS trigger AS $$
BEGIN
  IF NEW."taskId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."taskId" IS DISTINCT FROM OLD."taskId") THEN
    IF NOT EXISTS (SELECT 1 FROM "WorkflowTask" WHERE "id" = NEW."taskId" AND "kind" = 'WORK_ORDER') THEN
      RAISE EXCEPTION 'Tid rapporteras på en arbetsorder eller ett projekt, inte på en uppgift.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WorkflowTimeEntry_on_work_order" BEFORE INSERT OR UPDATE OF "taskId" ON "WorkflowTimeEntry"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_time_on_work_order"();
