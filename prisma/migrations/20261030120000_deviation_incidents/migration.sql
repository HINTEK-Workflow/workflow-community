-- Tillbud i avvikelseloggen (2026-10-30): a type on every deviation (egenkontroll as before, riskobservation, tillbud,
-- olycksfall), the investigation fields, "allvarlig" with when it was reported to the authority, the line written when it is
-- marked done, and photos before and after. Additive only: new columns with defaults, one unique index on (id,
-- organizationId) for the photos' company-bound key, and one new table; nothing existing is changed or deleted.
-- Its own transaction: Prisma runs a file statement by statement (tests/migration-interrupted.integration.ts).
BEGIN;

ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'SELF_INSPECTION';
ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "occurredAt" TIMESTAMP(3);
ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "whatHappened" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "cause" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "serious" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "personalInjury" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "electrical" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "reportedToAuthorityAt" TIMESTAMP(3);
ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "reportedToAuthorityById" TEXT;
ALTER TABLE "SelfInspectionDeviation" ADD COLUMN "doneNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SelfInspectionDeviation" ADD CONSTRAINT "SelfInspectionDeviation_type_check"
  CHECK ("type" IN ('SELF_INSPECTION', 'RISK_OBSERVATION', 'NEAR_MISS', 'ACCIDENT'));
ALTER TABLE "SelfInspectionDeviation" ADD CONSTRAINT "SelfInspectionDeviation_incident_text_check"
  CHECK (char_length("whatHappened") <= 4000 AND char_length("cause") <= 4000 AND char_length("doneNote") <= 500);
CREATE INDEX "SelfInspectionDeviation_organizationId_type_status_idx" ON "SelfInspectionDeviation"("organizationId", "type", "status");
CREATE UNIQUE INDEX "SelfInspectionDeviation_id_organizationId_key" ON "SelfInspectionDeviation"("id", "organizationId");

CREATE TABLE "SelfInspectionDeviationAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviationId" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'BEFORE',
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfInspectionDeviationAttachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SelfInspectionDeviationAttachment_phase_check" CHECK ("phase" IN ('BEFORE', 'AFTER'))
);
CREATE UNIQUE INDEX "SelfInspectionDeviationAttachment_storagePath_key" ON "SelfInspectionDeviationAttachment"("storagePath");
CREATE INDEX "SelfInspectionDeviationAttachment_organizationId_deviationI_idx" ON "SelfInspectionDeviationAttachment"("organizationId", "deviationId");
ALTER TABLE "SelfInspectionDeviationAttachment" ADD CONSTRAINT "SelfInspectionDeviationAttachment_deviationId_organization_fkey"
  FOREIGN KEY ("deviationId", "organizationId") REFERENCES "SelfInspectionDeviation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
