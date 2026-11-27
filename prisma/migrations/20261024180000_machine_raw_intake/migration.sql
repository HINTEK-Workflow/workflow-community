-- Integrationsmotorn E4 (2026-10-24, beslut 3 "JSON via HTTPS med konfigurerbara formatprofiler", plan
-- docs/proposals/integrationsmotor-plan-2026-10-24.md): format profiles as data, a source's profile, "fånga prov" (raw
-- samples for 24 hours) and the 10-minute body hash for bodies without a time. Additive: three new tables and two nullable
-- columns. All data so far is test data; nothing is deleted.

CREATE TABLE "MachineFormatProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "definition" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineFormatProfile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MachineFormatProfile_name_check" CHECK (char_length("name") BETWEEN 1 AND 80),
    CONSTRAINT "MachineFormatProfile_definition_check" CHECK (jsonb_typeof("definition") = 'object' AND octet_length("definition"::text) <= 32768)
);
CREATE UNIQUE INDEX "MachineFormatProfile_id_organizationId_key" ON "MachineFormatProfile"("id", "organizationId");
CREATE INDEX "MachineFormatProfile_organizationId_name_idx" ON "MachineFormatProfile"("organizationId", "name");
ALTER TABLE "MachineFormatProfile" ADD CONSTRAINT "MachineFormatProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The source's profile: composite, so it is always the source's own company's; a profile in use cannot be removed.
ALTER TABLE "MachineSource" ADD COLUMN "profileId" TEXT;
ALTER TABLE "MachineSource" ADD COLUMN "captureUntil" TIMESTAMP(3);
ALTER TABLE "MachineSource" ADD CONSTRAINT "MachineSource_profileId_organizationId_fkey" FOREIGN KEY ("profileId", "organizationId") REFERENCES "MachineFormatProfile"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE INDEX "MachineSource_profileId_idx" ON "MachineSource"("profileId");

CREATE TABLE "MachineRawSample" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "body" TEXT NOT NULL,

    CONSTRAINT "MachineRawSample_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MachineRawSample_body_check" CHECK (octet_length("body") <= 65536)
);
CREATE INDEX "MachineRawSample_sourceId_receivedAt_idx" ON "MachineRawSample"("sourceId", "receivedAt");
CREATE INDEX "MachineRawSample_receivedAt_idx" ON "MachineRawSample"("receivedAt");
ALTER TABLE "MachineRawSample" ADD CONSTRAINT "MachineRawSample_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineRawSample" ADD CONSTRAINT "MachineRawSample_sourceId_organizationId_fkey" FOREIGN KEY ("sourceId", "organizationId") REFERENCES "MachineSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MachineRawDedupe" (
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineRawDedupe_pkey" PRIMARY KEY ("sourceId", "hash"),
    CONSTRAINT "MachineRawDedupe_hash_check" CHECK ("hash" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "MachineRawDedupe_createdAt_idx" ON "MachineRawDedupe"("createdAt");
ALTER TABLE "MachineRawDedupe" ADD CONSTRAINT "MachineRawDedupe_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineRawDedupe" ADD CONSTRAINT "MachineRawDedupe_sourceId_organizationId_fkey" FOREIGN KEY ("sourceId", "organizationId") REFERENCES "MachineSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
