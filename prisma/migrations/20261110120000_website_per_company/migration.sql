-- Min webbsida (2026-11-10): the website connection, the page drafts and the backups belong to a company. Every company's admin
-- connects its own WordPress (one connection per company); the first site's rows are moved to the company that saved them.
-- Only additions: new nullable columns, a new key for the drafts (the old app writes drafts without one; the database gives it),
-- new indexes and foreign keys. The old app keeps working on this schema while the new one starts.
--
-- Whose is the first site's row 'site' (the only row before this migration), the first rule that names an existing company:
--   1. the company in the connection's own marker auto.auditTo.organizationId (written by every save of the connection: the
--      company the superadmin was acting in when it was saved);
--   2. the company of the newest audit event website_connection by the user who saved the connection last (updatedById);
--   3. the one company where that user, a SUPERADMIN, is an active ADMIN or OWNER (only when there is exactly one).
-- Otherwise the row keeps organizationId NULL: no company sees it, nothing is lost, and it can be given to its company by hand.
-- The drafts and backups (all of the first site) follow the connection row's company.
BEGIN;

DROP INDEX "WebsitePageBackup_pageId_createdAt_idx";

ALTER TABLE "WebsiteConnection" ADD COLUMN "organizationId" TEXT,
ADD COLUMN "siteUrl" TEXT,
ALTER COLUMN "id" DROP DEFAULT;

ALTER TABLE "WebsitePageDraft" DROP CONSTRAINT "WebsitePageDraft_pkey",
ADD COLUMN "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
ADD COLUMN "organizationId" TEXT,
ADD CONSTRAINT "WebsitePageDraft_pkey" PRIMARY KEY ("id");

ALTER TABLE "WebsitePageBackup" ADD COLUMN "organizationId" TEXT;

WITH site AS (
  SELECT "auto", "updatedById" FROM "WebsiteConnection" WHERE "id" = 'site'
), admins AS (
  SELECT m."organizationId", m."userId" FROM "OrganizationMember" m
  JOIN "User" u ON u."id" = m."userId" AND u."role" = 'SUPERADMIN'
  WHERE m."isActive" AND m."role" IN ('ADMIN', 'OWNER')
), candidates AS (
  SELECT 1 AS "rank", site."auto" -> 'auditTo' ->> 'organizationId' AS "organizationId", NULL::timestamp(3) AS "at" FROM site
  UNION ALL
  SELECT 2, e."organizationId", e."createdAt" FROM "AdministrationEvent" e JOIN site ON e."actorId" = site."updatedById"
  WHERE e."action" = 'website_connection'
  UNION ALL
  SELECT 3, a."organizationId", NULL FROM admins a JOIN site ON a."userId" = site."updatedById"
  WHERE (SELECT count(*) FROM admins other WHERE other."userId" = site."updatedById") = 1
), chosen AS (
  SELECT c."organizationId" FROM candidates c JOIN "Organization" o ON o."id" = c."organizationId"
  ORDER BY c."rank", c."at" DESC NULLS LAST LIMIT 1
)
UPDATE "WebsiteConnection" SET "organizationId" = (SELECT "organizationId" FROM chosen)
WHERE "id" = 'site' AND "organizationId" IS NULL;

UPDATE "WebsitePageDraft" SET "organizationId" = (SELECT "organizationId" FROM "WebsiteConnection" WHERE "id" = 'site')
WHERE "organizationId" IS NULL;
UPDATE "WebsitePageBackup" SET "organizationId" = (SELECT "organizationId" FROM "WebsiteConnection" WHERE "id" = 'site')
WHERE "organizationId" IS NULL;

CREATE UNIQUE INDEX "WebsiteConnection_organizationId_key" ON "WebsiteConnection"("organizationId");
CREATE UNIQUE INDEX "WebsitePageDraft_organizationId_pageId_key" ON "WebsitePageDraft"("organizationId", "pageId");
CREATE INDEX "WebsitePageBackup_organizationId_pageId_createdAt_idx" ON "WebsitePageBackup"("organizationId", "pageId", "createdAt");

ALTER TABLE "WebsiteConnection" ADD CONSTRAINT "WebsiteConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsitePageDraft" ADD CONSTRAINT "WebsitePageDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsitePageBackup" ADD CONSTRAINT "WebsitePageBackup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
