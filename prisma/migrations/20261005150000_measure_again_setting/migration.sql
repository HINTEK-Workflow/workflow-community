-- "Mät igen" in protocols (2026-10-05): a company setting, off by default.
ALTER TABLE "WorkspaceSettings" ADD COLUMN "measureAgain" BOOLEAN NOT NULL DEFAULT false;
