-- Centrala nycklar och datanycklar (2026-10-25): the sealed local copy of the installation's central keys, and a data key per company
-- for the company's external keys (beslut 3a). Only additions: nothing existing is changed or moved here; the values are
-- moved by scripts/secrets/reseal.ts (with a verified backup, a check run first and a way back).
ALTER TABLE "SystemSettings" ADD COLUMN "centralSecrets" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "OrganizationDataKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    CONSTRAINT "OrganizationDataKey_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrganizationDataKey_organizationId_retiredAt_idx" ON "OrganizationDataKey"("organizationId", "retiredAt");
-- At most one active data key per company.
CREATE UNIQUE INDEX "OrganizationDataKey_one_active" ON "OrganizationDataKey"("organizationId") WHERE "retiredAt" IS NULL;
ALTER TABLE "OrganizationDataKey" ADD CONSTRAINT "OrganizationDataKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
