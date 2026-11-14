-- Egenkontroll, the document view (2026-10-06): what the programme says about each person's competence – the
-- work the person may do, the assessment, limitations and supervision. Part of the draft; an approved version freezes
-- it in its content, so SelfInspectionVersion and its trigger are untouched. Additive and safe to run again.

CREATE TABLE IF NOT EXISTS "SelfInspectionCompetence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workTypes" TEXT[],
    "scope" TEXT NOT NULL DEFAULT '',
    "assessment" TEXT NOT NULL DEFAULT '',
    "assessedAt" TEXT,
    "limitations" TEXT NOT NULL DEFAULT '',
    "supervised" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionCompetence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SelfInspectionCompetence_programId_userId_key" ON "SelfInspectionCompetence"("programId", "userId");
CREATE INDEX IF NOT EXISTS "SelfInspectionCompetence_organizationId_userId_idx" ON "SelfInspectionCompetence"("organizationId", "userId");

-- The programme and the membership keys keep every row inside its company.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCompetence_programId_organizationId_fkey') THEN
    ALTER TABLE "SelfInspectionCompetence" ADD CONSTRAINT "SelfInspectionCompetence_programId_organizationId_fkey"
      FOREIGN KEY ("programId", "organizationId") REFERENCES "SelfInspectionProgram"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCompetence_organizationId_userId_fkey') THEN
    ALTER TABLE "SelfInspectionCompetence" ADD CONSTRAINT "SelfInspectionCompetence_organizationId_userId_fkey"
      FOREIGN KEY ("organizationId", "userId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
