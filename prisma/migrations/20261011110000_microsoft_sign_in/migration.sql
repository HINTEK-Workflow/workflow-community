-- Inloggning med Microsoft (2026-10-11). Additive only: an empty settings column (= off) and a nullable company lock.
-- Linked Microsoft accounts use the existing AuthAccount table (provider "microsoft", providerAccountId "<tid>:<oid>").

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "microsoftSignIn" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "WorkspaceSettings" ADD COLUMN     "microsoftTenantId" TEXT;
