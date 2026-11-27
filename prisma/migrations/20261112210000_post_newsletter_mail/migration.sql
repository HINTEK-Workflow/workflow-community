-- Även som nyhetsbrev (2026-11-12): the newsletter's own subject, text, link and picture choice beside the post; null
-- follows the post. Additive: one nullable column; the old app never reads it.
BEGIN;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN "newsletterMail" JSONB;

COMMIT;
