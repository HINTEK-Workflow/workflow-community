CREATE TYPE "DataStorageMode" AS ENUM ('LOCAL', 'HINTEK_CLOUD');

ALTER TABLE "Organization"
ADD COLUMN "storageMode" "DataStorageMode" NOT NULL DEFAULT 'LOCAL';

-- Existing private-test workspaces already use server persistence. Keep their
-- current behaviour while all newly created organizations default to LOCAL.
UPDATE "Organization" SET "storageMode" = 'HINTEK_CLOUD';
