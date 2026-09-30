-- API/MCP server (2026-09-30): an issued key acts for one member of the company, with exactly that person's
-- rights. NULL keeps the earlier meaning: the admin who created the key.
ALTER TABLE "IntegrationKey" ADD COLUMN "actingUserId" TEXT;
