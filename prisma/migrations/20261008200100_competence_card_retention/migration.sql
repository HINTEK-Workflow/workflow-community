-- Kompetenskort (2026-10-07): a competence card is kept for three months after the person leaves the company
-- and is then deleted by the nightly job (npm run history:retention); an admin can delete it at any time. Certificates
-- and proofs can be attached to the lines of a card.
--
-- Safe to run again. Nothing is deleted here: the card used to go with the membership through a key to it, and that key
-- is replaced by keys to the company and to the person plus a trigger that sets `leftAt` when the membership ends.

ALTER TABLE "SelfInspectionCredential" ADD COLUMN IF NOT EXISTS "leftAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "SelfInspectionCredential_leftAt_idx" ON "SelfInspectionCredential"("leftAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SelfInspectionCredential_id_organizationId_key" ON "SelfInspectionCredential"("id", "organizationId");

-- The card outlives the membership: the key to it (which deleted the card with it) is replaced by keys to the company
-- and to the person.
ALTER TABLE "SelfInspectionCredential" DROP CONSTRAINT IF EXISTS "SelfInspectionCredential_organizationId_userId_fkey";
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCredential_organizationId_fkey' AND conrelid = '"SelfInspectionCredential"'::regclass) THEN
    ALTER TABLE "SelfInspectionCredential" ADD CONSTRAINT "SelfInspectionCredential_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCredential_userId_fkey' AND conrelid = '"SelfInspectionCredential"'::regclass) THEN
    ALTER TABLE "SelfInspectionCredential" ADD CONSTRAINT "SelfInspectionCredential_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- A line is only added for a member of the company (what the key to the membership used to say). It is checked when a
-- line is written, not when the membership ends, so a card can stay after its person has left.
CREATE OR REPLACE FUNCTION "self_inspection_credential_member_check"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "OrganizationMember" WHERE "organizationId" = NEW."organizationId" AND "userId" = NEW."userId") THEN
    RAISE EXCEPTION 'Ett kompetenskort måste höra till en medlem i företaget.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "SelfInspectionCredential_member_check" ON "SelfInspectionCredential";
CREATE TRIGGER "SelfInspectionCredential_member_check" BEFORE INSERT OR UPDATE OF "organizationId", "userId" ON "SelfInspectionCredential"
  FOR EACH ROW EXECUTE FUNCTION "self_inspection_credential_member_check"();

-- The membership ends (removed by an admin): the person's card starts its three months. UTC, like Prisma's DateTime.
CREATE OR REPLACE FUNCTION "self_inspection_credential_member_left"() RETURNS trigger AS $$
BEGIN
  UPDATE "SelfInspectionCredential" SET "leftAt" = (now() AT TIME ZONE 'UTC')
    WHERE "organizationId" = OLD."organizationId" AND "userId" = OLD."userId" AND "leftAt" IS NULL;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "OrganizationMember_credential_left" ON "OrganizationMember";
CREATE TRIGGER "OrganizationMember_credential_left" BEFORE DELETE ON "OrganizationMember"
  FOR EACH ROW EXECUTE FUNCTION "self_inspection_credential_member_left"();

-- The person is a member again within the three months (a new invitation): the card is theirs again.
CREATE OR REPLACE FUNCTION "self_inspection_credential_member_back"() RETURNS trigger AS $$
BEGIN
  UPDATE "SelfInspectionCredential" SET "leftAt" = NULL
    WHERE "organizationId" = NEW."organizationId" AND "userId" = NEW."userId" AND "leftAt" IS NOT NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "OrganizationMember_credential_back" ON "OrganizationMember";
CREATE TRIGGER "OrganizationMember_credential_back" AFTER INSERT ON "OrganizationMember"
  FOR EACH ROW EXECUTE FUNCTION "self_inspection_credential_member_back"();

-- Certificates and proofs attached to a line of a card: private files in the shared storage, removed with the line.
CREATE TABLE IF NOT EXISTS "SelfInspectionCredentialFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfInspectionCredentialFile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SelfInspectionCredentialFile_storagePath_key" ON "SelfInspectionCredentialFile"("storagePath");
CREATE INDEX IF NOT EXISTS "SelfInspectionCredentialFile_organizationId_credentialId_idx" ON "SelfInspectionCredentialFile"("organizationId", "credentialId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionCredentialFile_credentialId_organizationId_fkey' AND conrelid = '"SelfInspectionCredentialFile"'::regclass) THEN
    ALTER TABLE "SelfInspectionCredentialFile" ADD CONSTRAINT "SelfInspectionCredentialFile_credentialId_organizationId_fkey"
      FOREIGN KEY ("credentialId", "organizationId") REFERENCES "SelfInspectionCredential"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
