-- Webb och inlägg (2026-11-20, 0.77.0): Inlägg and Min webbsida are a module of their own (lib/workflow/modules.ts, web_posts),
-- off from the start for a new company. A company that already exists keeps it on when it uses it (a connection to WordPress, Meta or
-- LinkedIn, a post, a series, a scheduled item, a posting rhythm or a page draft) and when it is the installation's own company or a
-- seeded one (a slug that registration never gives: not company-<random>). Every other existing company gets it off, as a new one.
-- Only data: no column changes, nothing removed. A company's own list of what is off is only added to, and a second run changes nothing.
-- The old app ignores the unknown key (normalizeDisabledModules keeps known keys only).
BEGIN;

UPDATE "Organization" AS o
SET "disabledModules" = array_append(o."disabledModules", 'web_posts')
WHERE o."slug" LIKE 'company-%'
  AND NOT ('web_posts' = ANY (o."disabledModules"))
  AND NOT EXISTS (SELECT 1 FROM "WebsiteConnection" x WHERE x."organizationId" = o."id")
  AND NOT EXISTS (SELECT 1 FROM "MetaConnection" x WHERE x."organizationId" = o."id")
  AND NOT EXISTS (SELECT 1 FROM "LinkedInConnection" x WHERE x."organizationId" = o."id")
  AND NOT EXISTS (SELECT 1 FROM "SocialPost" x WHERE x."organizationId" = o."id")
  AND NOT EXISTS (SELECT 1 FROM "ContentSeries" x WHERE x."organizationId" = o."id")
  AND NOT EXISTS (SELECT 1 FROM "ScheduledPublish" x WHERE x."organizationId" = o."id")
  AND NOT EXISTS (SELECT 1 FROM "PostingRhythm" x WHERE x."organizationId" = o."id")
  AND NOT EXISTS (SELECT 1 FROM "WebsitePageDraft" x WHERE x."organizationId" = o."id");

COMMIT;
