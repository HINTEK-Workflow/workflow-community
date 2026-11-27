-- HINTEK AI's provider set in the app: the sealed key and the switches (empty = the server's .env).
ALTER TABLE "SystemSettings" ADD COLUMN "aiProvider" JSONB NOT NULL DEFAULT '{}';
