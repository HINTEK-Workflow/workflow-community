-- Sök (2026-10-05: "en förbättrad sökfunktion … den ska inte använda AI men vara så bra som möjligt utan").
--
-- search_fold(): lower case and Swedish/Latin diacritics folded to their base letter, one character to one character.
-- The same table as lib/search/normalize.ts (SEARCH_FOLD_FROM/SEARCH_FOLD_TO); tests/search.test.ts checks that the
-- two agree. Immutable, so it can be used in expression indexes. unaccent is not used: its function is only stable.
CREATE OR REPLACE FUNCTION search_fold(value text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT translate(lower(value), 'åÅäÄàÀáÁâÂãÃæÆöÖøØóÓòÒôÔõÕéÉèÈêÊëËíÍìÌîÎïÏúÚùÙûÛüÜýÝÿŸçÇñÑ', 'aaaaaaaaaaaaaaooooooooooooeeeeeeeeiiiiiiiiuuuuuuuuyyyyccnn') $$;

-- The folded text of a task's and a control's own fields and answers, kept up to date by a trigger on every write, so
-- a search never folds long protocol answers row by row. A protocol's copy of its form (details.document) is left out.
-- Prisma never reads or writes the column (`searchText String? @ignore`). A trigger rather than a generated column,
-- because Prisma Migrate would otherwise try to drop the generation expression. If search_fold() or these fields
-- change, update the functions and run the backfill below again in that migration.
ALTER TABLE "WorkflowTask" ADD COLUMN IF NOT EXISTS "searchText" text;
ALTER TABLE "Control" ADD COLUMN IF NOT EXISTS "searchText" text;

CREATE OR REPLACE FUNCTION workflow_task_search_text() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchText" := search_fold(left(
    coalesce(NEW.title, '') || ' ' || coalesce(NEW."assignedToName", '') || ' ' ||
    CASE NEW.kind WHEN 'WORK_ORDER' THEN 'arbetsorder' WHEN 'RISK_ASSESSMENT' THEN 'riskbedömning' ELSE coalesce(NEW.data -> 'details' ->> 'templateName', '') || ' protokoll' END || ' ' ||
    coalesce(NEW.description, '') || ' ' ||
    coalesce(CASE WHEN NEW.kind = 'FORM' THEN (NEW.data -> 'details' -> 'values')::text ELSE (NEW.data -> 'details')::text END, ''),
    20000));
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "WorkflowTask_search_text" ON "WorkflowTask";
CREATE TRIGGER "WorkflowTask_search_text" BEFORE INSERT OR UPDATE OF title, description, "assignedToName", kind, data ON "WorkflowTask"
  FOR EACH ROW EXECUTE FUNCTION workflow_task_search_text();

CREATE OR REPLACE FUNCTION control_search_text() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchText" := search_fold(left(
    NEW.number::text || ' ' || coalesce(NEW.title, '') || ' ' || coalesce(NEW.project, '') || ' ' || coalesce(NEW.performer, '') || ' ' ||
    coalesce(NEW.date, '') || ' kontroll före idrifttagning kfid ' || coalesce(NEW.data::text, ''),
    20000));
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS "Control_search_text" ON "Control";
CREATE TRIGGER "Control_search_text" BEFORE INSERT OR UPDATE OF number, title, project, performer, date, data ON "Control"
  FOR EACH ROW EXECUTE FUNCTION control_search_text();

-- Existing rows: assigning a column the trigger watches runs it once per row (nothing else changes).
UPDATE "WorkflowTask" SET title = title;
UPDATE "Control" SET title = title;

-- pg_trgm is a trusted extension (PostgreSQL 13+), so the database owner may create it. Optional: without it Sök still
-- works and only the typing-error pass reads the most recent rows instead of using these indexes.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm is not available (%); Sök works without trigram indexes.', SQLERRM;
END
$$;

-- Trigram indexes on the folded titles and names, for the typing-error pass (word <% search_fold(title)).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "WorkflowTask_search_title_trgm" ON "WorkflowTask" USING gin (search_fold(title) gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Project_search_name_trgm" ON "Project" USING gin (search_fold(name) gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Control_search_title_trgm" ON "Control" USING gin (search_fold(title) gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Customer_search_name_trgm" ON "Customer" USING gin (search_fold(name) gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "CustomerFacility_search_name_trgm" ON "CustomerFacility" USING gin (search_fold(name) gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "FormSchedule_search_title_trgm" ON "FormSchedule" USING gin (search_fold(title) gin_trgm_ops)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Sök trigram indexes were not created (%); search still works.', SQLERRM;
END
$$;
