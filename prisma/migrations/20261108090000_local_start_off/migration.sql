BEGIN;
-- Local för nya konton är avstängt (beslut 2026-11-08): ett sparat "på" i prisinställningarna stängs av.
-- Bara den ena flaggan i JSON-värdet ändras; ingen rad tas bort.
UPDATE "SystemSettings"
SET "commercial" = jsonb_set("commercial", '{localStorage,enabled}', 'false'::jsonb)
WHERE "commercial" #>> '{localStorage,enabled}' = 'true';
COMMIT;
