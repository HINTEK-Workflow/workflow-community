-- Integrationsmotorn E1 (2026-10-24, docs/proposals/integrationsmotor-plan-2026-10-24.md): a source gets a default
-- object in the place tree (a customer's or Eget företag), an event keeps the object it was received for, and the lock
-- "at most one open automatic order" is held per object (scopeKey), not per source. Additive: nullable columns, one column
-- with a default, a backfill of the new scopeKey from the source, and the open-row index replaced by one on the scope.
-- All data so far is test data; nothing is deleted.

-- Default object on the source, and the object an event and an alarm row were received for. Simple FKs with SET NULL (a
-- composite FK would try to null organizationId), guarded by the same-company trigger used by WorkflowTask.facilityId.
ALTER TABLE "MachineSource" ADD COLUMN "facilityId" TEXT;
ALTER TABLE "MachineEvent" ADD COLUMN "facilityId" TEXT;
ALTER TABLE "MachineAlarmOrder" ADD COLUMN "facilityId" TEXT;
ALTER TABLE "MachineAlarmOrder" ADD COLUMN "scopeKey" TEXT;

-- Existing rows keep today's behaviour: their scope is their source.
UPDATE "MachineAlarmOrder" SET "scopeKey" = 'source:' || "sourceId" WHERE "scopeKey" IS NULL;
ALTER TABLE "MachineAlarmOrder" ALTER COLUMN "scopeKey" SET NOT NULL;
ALTER TABLE "MachineAlarmOrder" ADD CONSTRAINT "MachineAlarmOrder_scopeKey_check" CHECK ("scopeKey" ~ '^(facility|signal|source):[A-Za-z0-9_-]{1,100}$');

ALTER TABLE "MachineSource" ADD CONSTRAINT "MachineSource_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "CustomerFacility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MachineEvent" ADD CONSTRAINT "MachineEvent_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "CustomerFacility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MachineAlarmOrder" ADD CONSTRAINT "MachineAlarmOrder_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "CustomerFacility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "MachineSource_facilityId_idx" ON "MachineSource"("facilityId");
CREATE INDEX "MachineEvent_facilityId_occurredAt_idx" ON "MachineEvent"("facilityId", "occurredAt");
CREATE INDEX "MachineAlarmOrder_organizationId_scopeKey_createdAt_idx" ON "MachineAlarmOrder"("organizationId", "scopeKey", "createdAt");
CREATE INDEX "MachineAlarmOrder_facilityId_idx" ON "MachineAlarmOrder"("facilityId");

-- The object is always in the row's own company (function from 20260927130000_customer_facilities).
CREATE TRIGGER "MachineSource_facility_tenant" BEFORE INSERT OR UPDATE OF "facilityId", "organizationId" ON "MachineSource"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_facility_tenant"();
CREATE TRIGGER "MachineEvent_facility_tenant" BEFORE INSERT OR UPDATE OF "facilityId", "organizationId" ON "MachineEvent"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_facility_tenant"();
CREATE TRIGGER "MachineAlarmOrder_facility_tenant" BEFORE INSERT OR UPDATE OF "facilityId", "organizationId" ON "MachineAlarmOrder"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_facility_tenant"();

-- At most ONE open row (pending or created) per company and scope: two sources on the same object make one open order,
-- and a router that serves several machines makes one per machine.
DROP INDEX "MachineAlarmOrder_one_open_per_source";
CREATE UNIQUE INDEX "MachineAlarmOrder_one_open_per_scope" ON "MachineAlarmOrder"("organizationId", "scopeKey") WHERE "status" IN ('pending', 'created');

-- The daily cap per company: 20 by default; only HINTEK's system administrator changes it.
ALTER TABLE "Organization" ADD COLUMN "machineDailyOrderCap" INTEGER NOT NULL DEFAULT 20,
ADD CONSTRAINT "Organization_machineDailyOrderCap_check" CHECK ("machineDailyOrderCap" BETWEEN 1 AND 500);
