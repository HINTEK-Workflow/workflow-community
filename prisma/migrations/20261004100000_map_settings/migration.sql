-- Karta från Lantmäteriet (2026-10-04): the sealed sign-in, layer, cache limit and last check.
ALTER TABLE "SystemSettings" ADD COLUMN "map" JSONB NOT NULL DEFAULT '{}';
