-- Inställningar → Funktioner (2026-10-07): "Kontor och avdelningar" is an optional function, off by default.
-- A company that already has offices or departments keeps using them, so it is switched on. Additive and repeatable.
ALTER TABLE "WorkspaceSettings" ADD COLUMN IF NOT EXISTS "officeStructure" BOOLEAN NOT NULL DEFAULT false;
INSERT INTO "WorkspaceSettings" ("id", "organizationId", "officeStructure")
SELECT gen_random_uuid()::text, used."organizationId", true
FROM (SELECT DISTINCT "organizationId" FROM "Site" UNION SELECT DISTINCT "organizationId" FROM "Department") AS used
ON CONFLICT ("organizationId") DO UPDATE SET "officeStructure" = true;
