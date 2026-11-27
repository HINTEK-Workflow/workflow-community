-- Inlägg (2026-11-10): a background picture for a post. Only additions: two nullable columns; the old app never reads them.
BEGIN;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "background" BYTEA,
ADD COLUMN     "backgroundSource" TEXT;


COMMIT;
