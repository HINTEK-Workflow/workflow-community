CREATE TABLE "CloudImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bundleSha256" TEXT NOT NULL,
    "sourceWorkspaceId" TEXT NOT NULL,
    "snapshotExportedAt" TIMESTAMP(3) NOT NULL,
    "importedBy" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloudImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CloudImport_organizationId_bundleSha256_key"
ON "CloudImport"("organizationId", "bundleSha256");

CREATE INDEX "CloudImport_organizationId_completedAt_idx"
ON "CloudImport"("organizationId", "completedAt");

ALTER TABLE "CloudImport"
ADD CONSTRAINT "CloudImport_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
