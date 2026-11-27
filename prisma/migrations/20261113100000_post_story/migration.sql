-- Även som story (2026-11-13): a post may also go out as a story (9:16) on the channels chosen for it, with the story's own ids
-- and its own short-lived picture address (Instagram fetches the story picture separately from the post's).
-- Additive: columns with defaults or null and one unique index; the old app never reads them.
BEGIN;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "toStory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storyFacebookId" TEXT,
ADD COLUMN     "storyInstagramId" TEXT,
ADD COLUMN     "storyImageKeyHash" TEXT,
ADD COLUMN     "storyImageKeyExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_storyImageKeyHash_key" ON "SocialPost"("storyImageKeyHash");

COMMIT;
