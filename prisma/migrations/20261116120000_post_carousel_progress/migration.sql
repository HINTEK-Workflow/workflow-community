-- Inlägg 0.67.0 (2026-11-16): Instagram-only text, campaign links per channel, the AI disclosure, publishing progress and more
-- pictures per post (an Instagram carousel, a Facebook post with several photos). Additive: new columns with defaults and one new
-- table; the old app never reads them.
-- Kampanjlänkar is off for every earlier post (its approved content stays exactly as it was) and on for new posts.
BEGIN;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "instagramText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SocialPost" ADD COLUMN     "campaignLinks" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SocialPost" ALTER COLUMN   "campaignLinks" SET DEFAULT true;
ALTER TABLE "SocialPost" ADD COLUMN     "aiGenerated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SocialPost" ADD COLUMN     "publishProgress" JSONB;

-- CreateTable
CREATE TABLE "SocialPostImage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "bytes" BYTEA NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'uppladdad',
    "imageKeyHash" TEXT,
    "imageKeyExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SocialPostImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialPostImage_imageKeyHash_key" ON "SocialPostImage"("imageKeyHash");
CREATE INDEX "SocialPostImage_organizationId_postId_position_idx" ON "SocialPostImage"("organizationId", "postId", "position");

-- AddForeignKey
-- The image and its post are always the same company (tenant relation, 2026-10-08).
CREATE UNIQUE INDEX "SocialPost_id_organizationId_key" ON "SocialPost"("id", "organizationId");
ALTER TABLE "SocialPostImage" ADD CONSTRAINT "SocialPostImage_postId_organizationId_fkey" FOREIGN KEY ("postId", "organizationId") REFERENCES "SocialPost"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
