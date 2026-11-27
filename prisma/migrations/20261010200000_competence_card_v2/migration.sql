-- Kompetenskort v2 (2026-10-08): the competence card gets the training's provider, the company's own competence
-- groups, driving licence (classes, valid until), languages with a level, a suggestion from the person and a version for
-- every save. The card follows the three-month rule of the training lines: the membership triggers set and clear `leftAt`
-- on the card too, and the nightly job (npm run history:retention) deletes the card with its versions and groups.
--
-- Safe to run again. Nothing is deleted or rewritten: existing lines get an empty provider, and a card row is only made
-- when a card is saved.

ALTER TABLE "SelfInspectionCredential" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "SelfInspectionCompetenceCard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "licenceClasses" TEXT[],
    "licenceValidUntil" TEXT,
    "languages" JSONB NOT NULL DEFAULT '[]',
    "suggestion" TEXT NOT NULL DEFAULT '',
    "suggestedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionCompetenceCard_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SelfInspectionCompetenceCard_organizationId_licenceValidUnt_idx" ON "SelfInspectionCompetenceCard"("organizationId", "licenceValidUntil");
CREATE INDEX IF NOT EXISTS "SelfInspectionCompetenceCard_leftAt_idx" ON "SelfInspectionCompetenceCard"("leftAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SelfInspectionCompetenceCard_organizationId_userId_key" ON "SelfInspectionCompetenceCard"("organizationId", "userId");

CREATE TABLE IF NOT EXISTS "SelfInspectionCompetenceGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionCompetenceGroup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SelfInspectionCompetenceGroup_organizationId_sortOrder_idx" ON "SelfInspectionCompetenceGroup"("organizationId", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "SelfInspectionCompetenceGroup_id_organizationId_key" ON "SelfInspectionCompetenceGroup"("id", "organizationId");

CREATE TABLE IF NOT EXISTS "SelfInspectionCompetenceGroupMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfInspectionCompetenceGroupMember_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SelfInspectionCompetenceGroupMember_organizationId_userId_idx" ON "SelfInspectionCompetenceGroupMember"("organizationId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "SelfInspectionCompetenceGroupMember_groupId_userId_key" ON "SelfInspectionCompetenceGroupMember"("groupId", "userId");

CREATE TABLE IF NOT EXISTS "SelfInspectionCompetenceCardVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "change" TEXT NOT NULL DEFAULT '',
    "savedById" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfInspectionCompetenceCardVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SelfInspectionCompetenceCardVersion_organizationId_userId_n_key" ON "SelfInspectionCompetenceCardVersion"("organizationId", "userId", "number");

-- Keys: the card belongs to the company and the person; a group place and a version belong to the card, and a group place
-- to a group of the same company (both keys carry organizationId).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCompetenceCard_organizationId_fkey' AND conrelid = '"SelfInspectionCompetenceCard"'::regclass) THEN
    ALTER TABLE "SelfInspectionCompetenceCard" ADD CONSTRAINT "SelfInspectionCompetenceCard_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCompetenceCard_userId_fkey' AND conrelid = '"SelfInspectionCompetenceCard"'::regclass) THEN
    ALTER TABLE "SelfInspectionCompetenceCard" ADD CONSTRAINT "SelfInspectionCompetenceCard_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCompetenceGroup_organizationId_fkey' AND conrelid = '"SelfInspectionCompetenceGroup"'::regclass) THEN
    ALTER TABLE "SelfInspectionCompetenceGroup" ADD CONSTRAINT "SelfInspectionCompetenceGroup_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCompetenceGroupMember_groupId_organizationId_fkey' AND conrelid = '"SelfInspectionCompetenceGroupMember"'::regclass) THEN
    ALTER TABLE "SelfInspectionCompetenceGroupMember" ADD CONSTRAINT "SelfInspectionCompetenceGroupMember_groupId_organizationId_fkey"
      FOREIGN KEY ("groupId", "organizationId") REFERENCES "SelfInspectionCompetenceGroup"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCompetenceGroupMember_organizationId_userId_fkey' AND conrelid = '"SelfInspectionCompetenceGroupMember"'::regclass) THEN
    ALTER TABLE "SelfInspectionCompetenceGroupMember" ADD CONSTRAINT "SelfInspectionCompetenceGroupMember_organizationId_userId_fkey"
      FOREIGN KEY ("organizationId", "userId") REFERENCES "SelfInspectionCompetenceCard"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCompetenceCardVersion_organizationId_userId_fkey' AND conrelid = '"SelfInspectionCompetenceCardVersion"'::regclass) THEN
    ALTER TABLE "SelfInspectionCompetenceCardVersion" ADD CONSTRAINT "SelfInspectionCompetenceCardVersion_organizationId_userId_fkey"
      FOREIGN KEY ("organizationId", "userId") REFERENCES "SelfInspectionCompetenceCard"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- A card is only made for a member of the company, as a training line (the same check, see 20261008200100).
DROP TRIGGER IF EXISTS "SelfInspectionCompetenceCard_member_check" ON "SelfInspectionCompetenceCard";
CREATE TRIGGER "SelfInspectionCompetenceCard_member_check" BEFORE INSERT OR UPDATE OF "organizationId", "userId" ON "SelfInspectionCompetenceCard"
  FOR EACH ROW EXECUTE FUNCTION "self_inspection_credential_member_check"();

-- The membership ends: the whole card – lines and the rest – starts its three months. UTC, like Prisma's DateTime.
CREATE OR REPLACE FUNCTION "self_inspection_credential_member_left"() RETURNS trigger AS $$
BEGIN
  UPDATE "SelfInspectionCredential" SET "leftAt" = (now() AT TIME ZONE 'UTC')
    WHERE "organizationId" = OLD."organizationId" AND "userId" = OLD."userId" AND "leftAt" IS NULL;
  UPDATE "SelfInspectionCompetenceCard" SET "leftAt" = (now() AT TIME ZONE 'UTC')
    WHERE "organizationId" = OLD."organizationId" AND "userId" = OLD."userId" AND "leftAt" IS NULL;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- The person is a member again within the three months: the card is theirs again.
CREATE OR REPLACE FUNCTION "self_inspection_credential_member_back"() RETURNS trigger AS $$
BEGIN
  UPDATE "SelfInspectionCredential" SET "leftAt" = NULL
    WHERE "organizationId" = NEW."organizationId" AND "userId" = NEW."userId" AND "leftAt" IS NOT NULL;
  UPDATE "SelfInspectionCompetenceCard" SET "leftAt" = NULL
    WHERE "organizationId" = NEW."organizationId" AND "userId" = NEW."userId" AND "leftAt" IS NOT NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A version is what the card said when it was saved: never changed afterwards (it goes only with the card).
CREATE OR REPLACE FUNCTION "self_inspection_card_version_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'En version av kompetenskortet kan inte ändras.' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "SelfInspectionCompetenceCardVersion_immutable" ON "SelfInspectionCompetenceCardVersion";
CREATE TRIGGER "SelfInspectionCompetenceCardVersion_immutable" BEFORE UPDATE ON "SelfInspectionCompetenceCardVersion"
  FOR EACH ROW EXECUTE FUNCTION "self_inspection_card_version_immutable"();
