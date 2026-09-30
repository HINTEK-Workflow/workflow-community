-- Central key administration (Daniel 2026-09-29): API and MCP keys issued by Workflow (hash only) and external keys
-- fetched from a provider (encrypted). Additive; one row per key, never the plain secret of an issued key.
-- CreateEnum
CREATE TYPE "IntegrationKeyKind" AS ENUM ('API', 'MCP', 'EXTERNAL');

-- CreateTable
CREATE TABLE "IntegrationKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "IntegrationKeyKind" NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "displayHint" TEXT NOT NULL,
    "secretHash" TEXT,
    "encryptedValue" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationKey_organizationId_kind_revokedAt_idx" ON "IntegrationKey"("organizationId", "kind", "revokedAt");

-- AddForeignKey
ALTER TABLE "IntegrationKey" ADD CONSTRAINT "IntegrationKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrationKey" ADD CONSTRAINT "IntegrationKey_secret_shape" CHECK (("kind" = 'EXTERNAL' AND "encryptedValue" IS NOT NULL OR "revokedAt" IS NOT NULL) OR ("kind" <> 'EXTERNAL' AND "secretHash" IS NOT NULL AND "encryptedValue" IS NULL));
