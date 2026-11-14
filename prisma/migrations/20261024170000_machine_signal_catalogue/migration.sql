-- Integrationsmotorn E2 (2026-10-24, beslut 4 "signaler ska kunna upptäckas automatiskt", plan
-- docs/proposals/integrationsmotor-plan-2026-10-24.md): the signal catalogue per source, the event's code signal, and the
-- analysis per scope (the object or signal it concerns) instead of per source. Additive: one new table, nullable columns,
-- a column with a default, a backfill of the suggestions' scope from their source, and the suggestions' unique index
-- widened by the scope. All data so far is test data; nothing is deleted.

CREATE TABLE "MachineSignal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'discovered',
    "name" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "facilityId" TEXT,
    "deadband" DOUBLE PRECISION,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lastValue" JSONB,
    "lastValueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineSignal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MachineSignal_kind_check" CHECK ("kind" IN ('number', 'boolean', 'text', 'code')),
    CONSTRAINT "MachineSignal_status_check" CHECK ("status" IN ('discovered', 'active', 'ignored')),
    -- A value's name as the intake allows it, or code:<the intake's code>; never the prototype names.
    CONSTRAINT "MachineSignal_key_check" CHECK ("key" ~ '^([A-Za-z0-9_.-]{1,40}|code:[!-~]{1,64})$' AND "key" NOT IN ('__proto__', 'constructor', 'prototype')),
    CONSTRAINT "MachineSignal_text_check" CHECK (char_length("name") <= 80 AND char_length("unit") <= 20),
    CONSTRAINT "MachineSignal_deadband_check" CHECK ("deadband" IS NULL OR ("deadband" >= 0 AND "deadband" < 1e12))
);

CREATE UNIQUE INDEX "MachineSignal_sourceId_key_key" ON "MachineSignal"("sourceId", "key");
CREATE UNIQUE INDEX "MachineSignal_id_organizationId_key" ON "MachineSignal"("id", "organizationId");
CREATE INDEX "MachineSignal_organizationId_status_idx" ON "MachineSignal"("organizationId", "status");
CREATE INDEX "MachineSignal_facilityId_idx" ON "MachineSignal"("facilityId");

ALTER TABLE "MachineSignal" ADD CONSTRAINT "MachineSignal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineSignal" ADD CONSTRAINT "MachineSignal_sourceId_organizationId_fkey" FOREIGN KEY ("sourceId", "organizationId") REFERENCES "MachineSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineSignal" ADD CONSTRAINT "MachineSignal_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "CustomerFacility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TRIGGER "MachineSignal_facility_tenant" BEFORE INSERT OR UPDATE OF "facilityId", "organizationId" ON "MachineSignal"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_facility_tenant"();

-- The event's code signal: same company and same source, checked by the database (a simple FK so SET NULL never touches
-- organizationId).
ALTER TABLE "MachineEvent" ADD COLUMN "signalId" TEXT;
ALTER TABLE "MachineEvent" ADD CONSTRAINT "MachineEvent_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "MachineSignal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "MachineEvent_signalId_occurredAt_idx" ON "MachineEvent"("signalId", "occurredAt");

CREATE OR REPLACE FUNCTION "machine_assert_signal_tenant"() RETURNS trigger AS $$
BEGIN
  IF NEW."signalId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."signalId" IS DISTINCT FROM OLD."signalId" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."sourceId" IS DISTINCT FROM OLD."sourceId") AND NOT EXISTS (
    SELECT 1 FROM "MachineSignal" WHERE "id" = NEW."signalId" AND "organizationId" = NEW."organizationId" AND "sourceId" = NEW."sourceId"
  ) THEN
    RAISE EXCEPTION 'Signalen tillhör inte samma källa.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MachineEvent_signal_tenant" BEFORE INSERT OR UPDATE OF "signalId", "organizationId", "sourceId" ON "MachineEvent"
  FOR EACH ROW EXECUTE FUNCTION "machine_assert_signal_tenant"();

-- Suggestions per scope: existing rows concern their source.
ALTER TABLE "MachineSuggestion" ADD COLUMN "scopeKey" TEXT;
UPDATE "MachineSuggestion" SET "scopeKey" = 'source:' || "sourceId" WHERE "scopeKey" IS NULL;
ALTER TABLE "MachineSuggestion" ALTER COLUMN "scopeKey" SET NOT NULL;
ALTER TABLE "MachineSuggestion" ADD CONSTRAINT "MachineSuggestion_scopeKey_check" CHECK ("scopeKey" ~ '^(facility|signal|source):[A-Za-z0-9_-]{1,100}$');
DROP INDEX "MachineSuggestion_sourceId_dedupeKey_key";
CREATE UNIQUE INDEX "MachineSuggestion_sourceId_scopeKey_dedupeKey_key" ON "MachineSuggestion"("sourceId", "scopeKey", "dedupeKey");

-- Signals over the cap are counted, not stored.
ALTER TABLE "MachineSource" ADD COLUMN "ignoredSignals" INTEGER NOT NULL DEFAULT 0;
