-- Files saved from the Import page that are not on a task yet (private to the uploader).
CREATE TABLE "ImportedFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportedFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportedFile_storagePath_key" ON "ImportedFile"("storagePath");
CREATE INDEX "ImportedFile_organizationId_userId_createdAt_idx" ON "ImportedFile"("organizationId", "userId", "createdAt");

ALTER TABLE "ImportedFile" ADD CONSTRAINT "ImportedFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportedFile" ADD CONSTRAINT "ImportedFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
