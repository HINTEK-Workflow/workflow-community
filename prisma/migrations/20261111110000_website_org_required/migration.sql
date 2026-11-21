-- Min webbsida (2026-11-10, the stricter rule): every website row belongs to a company. The rows of the first site
-- got their company in 20261110120000_website_per_company (production checked 2026-11-10: the connection, three drafts and
-- one backup, all with a company), and every version since 0.55.0 writes the company. A row without one stops the migration
-- with a message instead of being removed: nothing is deleted here.
-- migration-check: breaking-approved (0.55.0, the version before, always writes organizationId on these tables; production checked 2026-11-10 has no row without it)
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "WebsiteConnection" WHERE "organizationId" IS NULL)
    OR EXISTS (SELECT 1 FROM "WebsitePageDraft" WHERE "organizationId" IS NULL)
    OR EXISTS (SELECT 1 FROM "WebsitePageBackup" WHERE "organizationId" IS NULL) THEN
    RAISE EXCEPTION 'Min webbsida: en rad saknar företag (organizationId). Ge raden sitt företag för hand innan migreringen körs.';
  END IF;
END $$;

ALTER TABLE "WebsiteConnection" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "WebsitePageDraft" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "WebsitePageBackup" ALTER COLUMN "organizationId" SET NOT NULL;

COMMIT;
