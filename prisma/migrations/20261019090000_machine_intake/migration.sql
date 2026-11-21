-- Maskinintag (steg S2, docs/drift/MASKININTAG.md).
--
-- Additive only: two new tables. Nothing existing is changed or removed, and no enum is touched.
-- 1. A source belongs to one company and holds its own key (SHA-256 hash only); the key is not a member's key.
-- 2. An event points at its source through [sourceId, organizationId] -> [id, organizationId], so the database refuses
--    an event in another company than its source. (sourceId, eventId) is unique: a resent batch never makes a second row.
-- 3. CHECKs keep the closed value lists and the text limits, whatever writes the rows.

-- CreateTable
CREATE TABLE "MachineSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretHash" TEXT,
    "displayHint" TEXT NOT NULL,
    "keyExpiresAt" TIMESTAMP(3),
    "keyRevokedAt" TIMESTAMP(3),
    "keyIssuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "state" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "basis" TEXT,
    "values" JSONB,

    CONSTRAINT "MachineEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MachineEvent_type_check" CHECK ("type" IN ('alarm', 'state', 'diagnosis')),
    CONSTRAINT "MachineEvent_severity_check" CHECK ("severity" IN ('info', 'warning', 'fault', 'critical')),
    CONSTRAINT "MachineEvent_state_check" CHECK ("state" IS NULL OR "state" IN ('raised', 'cleared', 'running', 'stopped')),
    CONSTRAINT "MachineEvent_text_check" CHECK (char_length("text") <= 200 AND ("basis" IS NULL OR char_length("basis") <= 200))
);

-- CreateIndex
CREATE UNIQUE INDEX "MachineSource_id_organizationId_key" ON "MachineSource"("id", "organizationId");
CREATE INDEX "MachineSource_organizationId_name_idx" ON "MachineSource"("organizationId", "name");
CREATE UNIQUE INDEX "MachineEvent_sourceId_eventId_key" ON "MachineEvent"("sourceId", "eventId");
CREATE INDEX "MachineEvent_organizationId_occurredAt_idx" ON "MachineEvent"("organizationId", "occurredAt");
CREATE INDEX "MachineEvent_sourceId_occurredAt_idx" ON "MachineEvent"("sourceId", "occurredAt");

-- AddForeignKey
ALTER TABLE "MachineSource" ADD CONSTRAINT "MachineSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineEvent" ADD CONSTRAINT "MachineEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineEvent" ADD CONSTRAINT "MachineEvent_sourceId_organizationId_fkey" FOREIGN KEY ("sourceId", "organizationId") REFERENCES "MachineSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
