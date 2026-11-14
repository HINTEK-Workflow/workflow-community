-- Ej utfört (2026-10-28, 0.28.0 etapp 5): an occurrence of a round that will not be done is recorded with a required
-- reason, who and when – alternative A, its own traceable history. Keyed by the round and the day (YYYY-MM-DD), never by the
-- rule, so the history stays when the round's rule changes. No protocol is made for it, and the round's work order model
-- (several occurrences in one work order for a period) is unchanged; workOrderId only notes which work order held the day.
--
-- Append-only: a row is never deleted by the app (only with its company or round, CASCADE as RoundReminderDelivery), and an
-- UPDATE may only revoke an active row once (revokedAt, revokedById, revokedByName). Marking again after a revoke is a new
-- row. At most one active NOT_DONE per round and day (partial unique index). The recorder must be a member of the company
-- (the same trigger function as RoundReminderDelivery_member). Additive: one new table, nothing existing is changed.
--
-- Återgång i princip (no automatic down migration, as for the other migrations): DROP TABLE "RoundOccurrenceOutcome" and the
-- function workflow_round_outcome_append_only.
-- Its own transaction: Prisma runs a file statement by statement (tests/migration-interrupted.integration.ts).
BEGIN;

CREATE TABLE "RoundOccurrenceOutcome" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "occurrence" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'NOT_DONE',
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL DEFAULT '',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workOrderId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokedByName" TEXT,

    CONSTRAINT "RoundOccurrenceOutcome_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RoundOccurrenceOutcome_outcome_check" CHECK ("outcome" IN ('NOT_DONE')),
    CONSTRAINT "RoundOccurrenceOutcome_occurrence_check" CHECK ("occurrence" ~ '^\d{4}-\d{2}-\d{2}$'),
    -- The reason is stored trimmed (the route trims it): 3 to 1000 characters.
    CONSTRAINT "RoundOccurrenceOutcome_reason_check" CHECK (char_length("reason") BETWEEN 3 AND 1000 AND "reason" = btrim("reason")),
    -- Revoked is all or nothing: when and by whom.
    CONSTRAINT "RoundOccurrenceOutcome_revoked_check" CHECK (("revokedAt" IS NULL) = ("revokedById" IS NULL))
);

CREATE INDEX "RoundOccurrenceOutcome_organizationId_scheduleId_occurrence_idx" ON "RoundOccurrenceOutcome"("organizationId", "scheduleId", "occurrence");
CREATE INDEX "RoundOccurrenceOutcome_organizationId_recordedAt_idx" ON "RoundOccurrenceOutcome"("organizationId", "recordedAt");
-- One active Ej utfört per round and day; two people marking at the same moment cannot both pass (the route answers 409).
CREATE UNIQUE INDEX "RoundOccurrenceOutcome_one_active" ON "RoundOccurrenceOutcome"("scheduleId", "occurrence") WHERE "revokedAt" IS NULL;

-- Tenant relation (as RoundReminderDelivery since 20261009200000): the round is the same company's.
ALTER TABLE "RoundOccurrenceOutcome" ADD CONSTRAINT "RoundOccurrenceOutcome_scheduleId_organizationId_fkey"
  FOREIGN KEY ("scheduleId", "organizationId") REFERENCES "FormSchedule"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- The person who records it is a member of the company (checked on insert; the history stays if they leave later).
CREATE TRIGGER "RoundOccurrenceOutcome_member" BEFORE INSERT OR UPDATE OF "organizationId", "userId" ON "RoundOccurrenceOutcome"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_oauth_member"();

-- Append-only: only an active row may be revoked, once, and nothing else may change.
CREATE OR REPLACE FUNCTION "workflow_round_outcome_append_only"() RETURNS trigger AS $$
BEGIN
  -- Radering av en användare (lib/auth/erasure.ts): only the names may change, and only to the erased name.
  IF (NEW."userName" IS DISTINCT FROM OLD."userName" OR NEW."revokedByName" IS DISTINCT FROM OLD."revokedByName")
     AND (NEW."userName" = OLD."userName" OR NEW."userName" = 'Borttagen användare')
     AND (NEW."revokedByName" IS NOT DISTINCT FROM OLD."revokedByName" OR NEW."revokedByName" = 'Borttagen användare')
     AND (ROW(NEW."id", NEW."organizationId", NEW."scheduleId", NEW."occurrence", NEW."outcome", NEW."reason", NEW."userId", NEW."recordedAt", NEW."workOrderId", NEW."revokedAt", NEW."revokedById")
          IS NOT DISTINCT FROM ROW(OLD."id", OLD."organizationId", OLD."scheduleId", OLD."occurrence", OLD."outcome", OLD."reason", OLD."userId", OLD."recordedAt", OLD."workOrderId", OLD."revokedAt", OLD."revokedById")) THEN
    RETURN NEW;
  END IF;
  IF OLD."revokedAt" IS NOT NULL
     OR NEW."id" IS DISTINCT FROM OLD."id" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."scheduleId" IS DISTINCT FROM OLD."scheduleId" OR NEW."occurrence" IS DISTINCT FROM OLD."occurrence"
     OR NEW."outcome" IS DISTINCT FROM OLD."outcome" OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."userName" IS DISTINCT FROM OLD."userName"
     OR NEW."recordedAt" IS DISTINCT FROM OLD."recordedAt" OR NEW."workOrderId" IS DISTINCT FROM OLD."workOrderId" THEN
    RAISE EXCEPTION 'Ett registrerat rondtillfälle ändras inte. Ångra det och registrera på nytt.' USING ERRCODE = '23514';
  END IF;
  IF NEW."revokedAt" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "OrganizationMember" WHERE "organizationId" = NEW."organizationId" AND "userId" = NEW."revokedById"
  ) THEN
    RAISE EXCEPTION 'Personen är inte medlem i organisationen.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RoundOccurrenceOutcome_append_only" BEFORE UPDATE ON "RoundOccurrenceOutcome"
  FOR EACH ROW EXECUTE FUNCTION "workflow_round_outcome_append_only"();

COMMIT;
