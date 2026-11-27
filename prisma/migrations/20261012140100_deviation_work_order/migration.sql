-- Avvikelse ↔ arbetsorder ↔ egenkontrollens avvikelselogg (2026-10-10, kartläggningen 5.8). Additive: the log
-- entry gets the work order that fixes it and who closed it. The key is composite, so the order is always in the same
-- company; deleting the order clears only the link.

ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "workOrderId" TEXT,
ADD COLUMN "closedById" TEXT,
ADD COLUMN "closedByName" TEXT NOT NULL DEFAULT '';

CREATE INDEX "SelfInspectionDeviation_organizationId_workOrderId_idx" ON "SelfInspectionDeviation"("organizationId", "workOrderId");

ALTER TABLE "SelfInspectionDeviation" ADD CONSTRAINT "SelfInspectionDeviation_workOrderId_organizationId_fkey" FOREIGN KEY ("workOrderId", "organizationId") REFERENCES "WorkflowTask"("id", "organizationId") ON DELETE SET NULL ("workOrderId") ON UPDATE CASCADE;

-- The target must be a work order (a protocol or risk assessment is never "the order that fixes it").
CREATE OR REPLACE FUNCTION "workflow_deviation_work_order"() RETURNS trigger AS $$
BEGIN
  IF NEW."workOrderId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."workOrderId" IS DISTINCT FROM OLD."workOrderId") THEN
    IF NOT EXISTS (SELECT 1 FROM "WorkflowTask" WHERE "id" = NEW."workOrderId" AND "organizationId" = NEW."organizationId" AND "kind" = 'WORK_ORDER') THEN
      RAISE EXCEPTION 'Arbetsordern hittades inte i samma organisation.' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SelfInspectionDeviation_work_order" BEFORE INSERT OR UPDATE OF "workOrderId" ON "SelfInspectionDeviation"
  FOR EACH ROW EXECUTE FUNCTION "workflow_deviation_work_order"();
