-- Bokföring (2026-10-09, steg D): the company's own account mapping for the SIE export of accepted quotes.
ALTER TABLE "WorkspaceSettings" ADD COLUMN "accountingSettings" JSONB NOT NULL DEFAULT '{}';
