-- Time on commissioning controls (2026-09-26, decision 13): manual registration in Tidrapport. A time entry
-- belongs to exactly one work order/risk assessment or one control. Additive: existing entries keep their taskId.
ALTER TABLE "WorkflowTimeEntry" ALTER COLUMN "taskId" DROP NOT NULL;
ALTER TABLE "WorkflowTimeEntry" ADD COLUMN "controlId" TEXT;

CREATE INDEX "WorkflowTimeEntry_controlId_startedAt_idx" ON "WorkflowTimeEntry"("controlId", "startedAt");

ALTER TABLE "WorkflowTimeEntry" ADD CONSTRAINT "WorkflowTimeEntry_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowTimeEntry" ADD CONSTRAINT "WorkflowTimeEntry_one_owner_check" CHECK (("taskId" IS NULL) <> ("controlId" IS NULL));
