-- Egenkontroll och GDPR (2026-10-10): when a person is erased, an approved version keeps only the person's name
-- and role (who was responsible); the rest of what it froze about the person (authorisation level, competence
-- assessment) is removed. The version stays unchangeable for everything else: only lib/auth/erasure.ts, inside its own
-- transaction with `SET LOCAL workflow.self_inspection_erasure = 'on'`, may rewrite the content and fill in an empty
-- approver's name. Number, hash, reason, approver and time never change. Safe to run again.
CREATE OR REPLACE FUNCTION "self_inspection_version_unchangeable"() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('workflow.self_inspection_erasure', true), '') = 'on'
    AND NEW."id" = OLD."id" AND NEW."organizationId" = OLD."organizationId" AND NEW."programId" = OLD."programId"
    AND NEW."number" = OLD."number" AND NEW."contentHash" = OLD."contentHash" AND NEW."changeReason" = OLD."changeReason"
    AND NEW."approvedById" = OLD."approvedById" AND NEW."approvedAt" = OLD."approvedAt"
    AND (NEW."approvedByName" = OLD."approvedByName" OR OLD."approvedByName" = '') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'En fastställd version av egenkontrollprogrammet kan inte ändras.' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
