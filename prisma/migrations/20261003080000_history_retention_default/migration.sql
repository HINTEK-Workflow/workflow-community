-- Historik sparas 24 månader som standard (2026-10-03). Ett företag som själv har valt en lagringstid, även "tills vidare",
-- behåller sitt val; övriga får 24 månader.
ALTER TABLE "Organization" ALTER COLUMN "historyRetentionMonths" SET DEFAULT 24;
UPDATE "Organization" o SET "historyRetentionMonths" = 24
WHERE o."historyRetentionMonths" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "AdministrationEvent" e WHERE e."organizationId" = o.id AND e.action = 'history_retention_setting');
