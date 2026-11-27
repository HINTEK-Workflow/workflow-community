-- Egenkontroll, ny struktur (2026-11-24): Rollbeskrivningar, Kompetenskort, Organisation och ansvar och Inhyrd personal.
-- Only additions: new nullable columns or columns with a default, and three new tables. Nothing is renamed, rewritten or
-- deleted; the roles and their members stay as they are, and a role's level reads as the role's level requirement.
-- Safe to run again; one transaction, so it is all or nothing.

BEGIN;

ALTER TABLE "SelfInspectionProgram" ADD COLUMN IF NOT EXISTS "commonDuties" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SelfInspectionProgram" ADD COLUMN IF NOT EXISTS "levelYears" INTEGER[] DEFAULT ARRAY[2, 5]::INTEGER[];
ALTER TABLE "SelfInspectionProgram" ADD COLUMN IF NOT EXISTS "orgTreeSaved" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "SelfInspectionRole" ADD COLUMN IF NOT EXISTS "dutyGroups" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "SelfInspectionRole" ADD COLUMN IF NOT EXISTS "parentId" TEXT;
ALTER TABLE "SelfInspectionRole" ADD COLUMN IF NOT EXISTS "responsibility" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SelfInspectionRole" ADD COLUMN IF NOT EXISTS "treeOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SelfInspectionCredential" ADD COLUMN IF NOT EXISTS "groupId" TEXT;
ALTER TABLE "SelfInspectionCredential" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'TRAINING';

ALTER TABLE "SelfInspectionCompetenceCard" ADD COLUMN IF NOT EXISTS "educations" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "SelfInspectionCompetenceCard" ADD COLUMN IF NOT EXISTS "employedAt" TEXT;
ALTER TABLE "SelfInspectionCompetenceCard" ADD COLUMN IF NOT EXISTS "employmentForm" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SelfInspectionCompetenceCard" ADD COLUMN IF NOT EXISTS "experienceSince" TEXT;
ALTER TABLE "SelfInspectionCompetenceCard" ADD COLUMN IF NOT EXISTS "experienceYears" INTEGER;
ALTER TABLE "SelfInspectionCompetenceCard" ADD COLUMN IF NOT EXISTS "experienceYearsAt" TEXT;
ALTER TABLE "SelfInspectionCompetenceCard" ADD COLUMN IF NOT EXISTS "level" INTEGER;
ALTER TABLE "SelfInspectionCompetenceCard" ADD COLUMN IF NOT EXISTS "levelOverride" INTEGER;
ALTER TABLE "SelfInspectionCompetenceCard" ADD COLUMN IF NOT EXISTS "levelReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SelfInspectionCompetenceCard" ADD COLUMN IF NOT EXISTS "licenceCheckedAt" TEXT;
ALTER TABLE "SelfInspectionCompetenceCard" ADD COLUMN IF NOT EXISTS "ownTitle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SelfInspectionCompetenceCard" ADD COLUMN IF NOT EXISTS "practicalExperience" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "SelfInspectionExperienceArea" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionExperienceArea_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SelfInspectionExperienceArea_organizationId_sortOrder_idx" ON "SelfInspectionExperienceArea"("organizationId", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "SelfInspectionExperienceArea_id_organizationId_key" ON "SelfInspectionExperienceArea"("id", "organizationId");

CREATE TABLE IF NOT EXISTS "SelfInspectionExperienceAreaMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfInspectionExperienceAreaMember_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SelfInspectionExperienceAreaMember_organizationId_userId_idx" ON "SelfInspectionExperienceAreaMember"("organizationId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "SelfInspectionExperienceAreaMember_areaId_userId_key" ON "SelfInspectionExperienceAreaMember"("areaId", "userId");

CREATE TABLE IF NOT EXISTS "SelfInspectionExternalPerson" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyName" TEXT NOT NULL DEFAULT '',
    "companyOrgNumber" TEXT NOT NULL DEFAULT '',
    "roleId" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "competence" TEXT NOT NULL DEFAULT '',
    "periodFrom" TEXT,
    "periodTo" TEXT,
    "included" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionExternalPerson_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SelfInspectionExternalPerson_organizationId_name_idx" ON "SelfInspectionExternalPerson"("organizationId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "SelfInspectionExternalPerson_id_organizationId_key" ON "SelfInspectionExternalPerson"("id", "organizationId");

DO $$ BEGIN
  ALTER TABLE "SelfInspectionExperienceArea" ADD CONSTRAINT "SelfInspectionExperienceArea_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SelfInspectionExperienceAreaMember" ADD CONSTRAINT "SelfInspectionExperienceAreaMember_areaId_organizationId_fkey" FOREIGN KEY ("areaId", "organizationId") REFERENCES "SelfInspectionExperienceArea"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SelfInspectionExperienceAreaMember" ADD CONSTRAINT "SelfInspectionExperienceAreaMember_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "SelfInspectionCompetenceCard"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SelfInspectionExternalPerson" ADD CONSTRAINT "SelfInspectionExternalPerson_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The levels are 1–3; the kind of a line is one of three.
DO $$ BEGIN
  ALTER TABLE "SelfInspectionCompetenceCard" ADD CONSTRAINT "SelfInspectionCompetenceCard_level_check" CHECK (("level" IS NULL OR "level" BETWEEN 1 AND 3) AND ("levelOverride" IS NULL OR "levelOverride" BETWEEN 1 AND 3));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SelfInspectionExternalPerson" ADD CONSTRAINT "SelfInspectionExternalPerson_level_check" CHECK ("level" BETWEEN 1 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SelfInspectionCredential" ADD CONSTRAINT "SelfInspectionCredential_kind_check" CHECK ("kind" IN ('TRAINING', 'AUTHORIZATION', 'CERTIFICATE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
