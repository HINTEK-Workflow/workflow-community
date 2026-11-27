-- Min webbsida, Sökmotorer och delning (2026-11-11): a page's SEO values with its draft and its backups. Only additions:
-- three nullable columns; the version before never reads them, and a site without the SEO meta keeps them NULL.
BEGIN;

-- AlterTable
ALTER TABLE "WebsitePageDraft" ADD COLUMN     "seo" JSONB,
ADD COLUMN     "seoBase" JSONB;

-- AlterTable
ALTER TABLE "WebsitePageBackup" ADD COLUMN     "seo" JSONB;

COMMIT;
