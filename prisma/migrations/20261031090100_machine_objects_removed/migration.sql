-- Underhåll (2026-10-30): "Maskinobjekt i kundens platsträd tas bort (testdata). Maskinträdet börjar tomt."
--
-- Det här är ett EGET, uttryckligt steg efter 20261031090000_maintenance_module. Maskinkopplingens signaler, källor och
-- larmansvar pekar från och med nu på delar i maskinträdet (MachinePart), aldrig på kundens platser. Steget:
-- 1. samlar platserna som maskinkopplingen pekat på (källans standardobjekt, signalens objekt, larmansvar, dygnssammanfattning);
-- 2. kopplar loss maskinkopplingen från dem (facilityId = NULL på källor, signaler, händelser och larmrader; larmansvar och
--    dygnssammanfattningar på platserna tas bort – de var bara för maskinerna);
-- 3. tar bort de platserna, men BARA när ingenting annat hänger på dem: inga platser under, inga arbetsordrar eller uppgifter,
--    projekt, kontroller, offerter, rondscheman eller gränsprofiler. En plats som används av något annat står kvar (utan
--    maskinkoppling) och kan tas bort för hand.
-- Allt hittills är testdata (beslut 2026-10-18 och 2026-10-30). Ingen tabell eller kolumn tas bort.
-- migration-check: breaking-approved (beslut 2026-10-30: maskinobjekten i kundernas platsträd är testdata och tas bort; bara platser som inget annat pekar på)

BEGIN;

CREATE TEMP TABLE "machine_object_ids" ON COMMIT DROP AS
  SELECT DISTINCT "facilityId" AS "id" FROM (
    SELECT "facilityId" FROM "MachineSource" WHERE "facilityId" IS NOT NULL
    UNION SELECT "facilityId" FROM "MachineSignal" WHERE "facilityId" IS NOT NULL
    UNION SELECT "facilityId" FROM "MachineAlarmContact" WHERE "facilityId" IS NOT NULL
    UNION SELECT "facilityId" FROM "MachineDaySummary" WHERE "facilityId" IS NOT NULL
  ) AS "used";

UPDATE "MachineSource" SET "facilityId" = NULL WHERE "facilityId" IS NOT NULL;
UPDATE "MachineSignal" SET "facilityId" = NULL WHERE "facilityId" IS NOT NULL;
UPDATE "MachineEvent" SET "facilityId" = NULL WHERE "facilityId" IN (SELECT "id" FROM "machine_object_ids");
UPDATE "MachineAlarmOrder" SET "facilityId" = NULL WHERE "facilityId" IN (SELECT "id" FROM "machine_object_ids");
DELETE FROM "MachineAlarmContact" WHERE "facilityId" IS NOT NULL;
DELETE FROM "MachineDaySummary" WHERE "facilityId" IS NOT NULL;

DELETE FROM "CustomerFacility" f
WHERE f."id" IN (SELECT "id" FROM "machine_object_ids")
  AND NOT EXISTS (SELECT 1 FROM "CustomerFacility" c WHERE c."parentId" = f."id")
  AND NOT EXISTS (SELECT 1 FROM "WorkflowTask" t WHERE t."facilityId" = f."id")
  AND NOT EXISTS (SELECT 1 FROM "Project" p WHERE p."facilityId" = f."id")
  AND NOT EXISTS (SELECT 1 FROM "Control" k WHERE k."facilityId" = f."id")
  AND NOT EXISTS (SELECT 1 FROM "Quote" q WHERE q."facilityId" = f."id")
  AND NOT EXISTS (SELECT 1 FROM "FormSchedule" s WHERE s."facilityId" = f."id")
  AND NOT EXISTS (SELECT 1 FROM "FormLimitProfile" l WHERE l."facilityId" = f."id");

COMMIT;
