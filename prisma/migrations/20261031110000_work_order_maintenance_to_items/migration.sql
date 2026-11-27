-- Underhåll (2026-10-30): "underhållsfälten flyttar UT ur arbetsordern till en underhållspost som gäller en
-- maskindel och hålls av arbetsordern som en uppgift."
--
-- Arbetsorderns gamla Underhåll-ruta låg i JSON-datat: "WorkflowTask".data->'details'->'maintenance' (typ, prioritet,
-- kritikalitet, märkning, fel, orsak, felanmäld, ur drift, åter i drift och – för en pausad order – vad den väntar på).
-- Steget, bara för arbetsordrar (kind = 'WORK_ORDER'):
-- 1. En arbetsorder som står på en maskindel ("machinePartId") och har något ifyllt i rutan får en underhållspost på den
--    delen med samma uppgifter – om den inte redan håller en post (maskinlarmet och felanmälan skrev båda ställena, så
--    deras ordrar har redan sin post). Posten blir Klar för en färdigställd order (med orderns färdigdatum), Utgår för en
--    utgången, annars Pågår. Värden som inte är någon av de fasta koderna blir tomma; en tid som inte ser ut som en tidpunkt
--    blir tom; Åter i drift utan Ur drift, eller före den, blir tom (samma regel som posten själv har).
-- 2. Vad en pausad order väntar på hör till ordern: maintenance.waitingOn flyttar till details.waitingOn.
-- 3. Nyckeln details.maintenance tas bort på alla arbetsordrar. En order utan maskindel får ingen post – det finns ingen del
--    att sätta den på – och dess gamla uppgifter finns kvar i orderns historik ("WorkflowTaskRevision", som inte rörs).
--    Appen läser inte nyckeln längre och skulle ta bort den vid nästa sparning ändå.
-- Allt hittills är testdata (beslut 2026-10-18 och 2026-10-30). Ingen tabell eller kolumn ändras.

BEGIN;

CREATE TEMP TABLE "old_maintenance" ON COMMIT DROP AS
  SELECT t."id", t."organizationId", t."machinePartId", t."status", t."completedAt", t."createdBy", t."createdAt", t."data"->'details'->'maintenance' AS "m"
  FROM "WorkflowTask" t
  WHERE t."kind" = 'WORK_ORDER' AND jsonb_typeof(t."data"->'details'->'maintenance') = 'object';

CREATE TEMP TABLE "old_maintenance_items" ON COMMIT DROP AS
  SELECT o."id" AS "workOrderId", o."organizationId", o."machinePartId" AS "partId", o."status" AS "orderStatus", o."completedAt", o."createdBy", o."createdAt",
    CASE WHEN o."m"->>'type' IN ('PREVENTIVE', 'CORRECTIVE', 'CONDITION', 'IMPROVEMENT') THEN o."m"->>'type' ELSE '' END AS "type",
    CASE WHEN o."m"->>'priority' IN ('URGENT', 'HIGH', 'NORMAL', 'LOW') THEN o."m"->>'priority' ELSE '' END AS "priority",
    CASE WHEN o."m"->>'criticality' IN ('A', 'B', 'C') THEN o."m"->>'criticality' ELSE '' END AS "criticality",
    left(btrim(coalesce(o."m"->>'marking', '')), 40) AS "marking",
    left(btrim(coalesce(o."m"->>'fault', '')), 2000) AS "fault",
    CASE WHEN o."m"->>'cause' IN ('WEAR', 'HANDLING', 'EXTERNAL', 'INSTALLATION', 'UNKNOWN', 'OTHER') THEN o."m"->>'cause' ELSE '' END AS "cause",
    left(btrim(coalesce(o."m"->>'causeNote', '')), 500) AS "causeNote",
    CASE WHEN o."m"->>'reportedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' THEN ((o."m"->>'reportedAt')::timestamptz AT TIME ZONE 'UTC') END AS "reportedAt",
    CASE WHEN o."m"->>'stoppedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' THEN ((o."m"->>'stoppedAt')::timestamptz AT TIME ZONE 'UTC') END AS "stoppedAt",
    CASE WHEN o."m"->>'restoredAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' THEN ((o."m"->>'restoredAt')::timestamptz AT TIME ZONE 'UTC') END AS "restoredAt"
  FROM "old_maintenance" o
  WHERE o."machinePartId" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "MachinePart" p WHERE p."id" = o."machinePartId" AND p."organizationId" = o."organizationId")
    AND NOT EXISTS (SELECT 1 FROM "MaintenanceItem" i WHERE i."workOrderId" = o."id" AND i."organizationId" = o."organizationId");

-- Åter i drift needs Ur drift before it (lib/maintenance/model.ts itemTimeProblem).
UPDATE "old_maintenance_items" SET "restoredAt" = NULL WHERE "restoredAt" IS NOT NULL AND ("stoppedAt" IS NULL OR "restoredAt" < "stoppedAt");

INSERT INTO "MaintenanceItem" ("id", "organizationId", "partId", "workOrderId", "type", "priority", "criticality", "marking", "fault", "cause", "causeNote",
  "reportedAt", "stoppedAt", "restoredAt", "status", "source", "completedAt", "version", "createdById", "updatedById", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, n."organizationId", n."partId", n."workOrderId", n."type", n."priority", n."criticality", n."marking", n."fault", n."cause", n."causeNote",
  n."reportedAt", n."stoppedAt", n."restoredAt",
  CASE n."orderStatus" WHEN 'COMPLETED' THEN 'DONE' WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'OPEN' END,
  'MANUAL', CASE WHEN n."orderStatus" = 'COMPLETED' THEN coalesce(n."completedAt", CURRENT_TIMESTAMP) END, 1,
  n."createdBy", n."createdBy", n."createdAt", CURRENT_TIMESTAMP
FROM "old_maintenance_items" n
WHERE n."type" <> '' OR n."priority" <> '' OR n."criticality" <> '' OR n."marking" <> '' OR n."fault" <> '' OR n."cause" <> '' OR n."causeNote" <> ''
  OR n."reportedAt" IS NOT NULL OR n."stoppedAt" IS NOT NULL OR n."restoredAt" IS NOT NULL;

-- What a paused order waits for stays on the order; then the old key goes.
UPDATE "WorkflowTask" t
SET "data" = jsonb_set(t."data" #- '{details,maintenance}', '{details,waitingOn}', to_jsonb(o."m"->>'waitingOn'))
FROM "old_maintenance" o
WHERE t."id" = o."id" AND o."m"->>'waitingOn' IN ('MATERIAL', 'CUSTOMER', 'SHUTDOWN');

UPDATE "WorkflowTask" t
SET "data" = t."data" #- '{details,maintenance}'
FROM "old_maintenance" o
WHERE t."id" = o."id" AND t."data"->'details'->'maintenance' IS NOT NULL;

COMMIT;
