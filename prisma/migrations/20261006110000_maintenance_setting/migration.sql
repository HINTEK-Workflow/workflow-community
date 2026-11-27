-- Underhåll (2026-10-06, decision B1): an optional module per company, off by default.
ALTER TABLE "WorkspaceSettings" ADD COLUMN "maintenance" BOOLEAN NOT NULL DEFAULT false;
