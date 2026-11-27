-- Hashtaggar (2026-11-12): a post's own hashtag field, added after the text on Facebook, Instagram and LinkedIn.
-- Additive: one column with a default; the old app never reads it.
BEGIN;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "hashtags" TEXT NOT NULL DEFAULT '';

COMMIT;
