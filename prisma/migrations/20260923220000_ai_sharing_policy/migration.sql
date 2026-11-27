ALTER TABLE "WorkspaceSettings"
ADD COLUMN "aiPolicy" JSONB NOT NULL DEFAULT '{}'::jsonb;
