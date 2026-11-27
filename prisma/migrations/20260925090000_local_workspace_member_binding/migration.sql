-- A Local file owner is only eligible for future Cloud writeback after an
-- authenticated Cloud export created this tenant- and member-bound record.
CREATE TABLE "LocalWorkspaceBinding" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "localIdentityId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  CONSTRAINT "LocalWorkspaceBinding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LocalWorkspaceBinding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LocalWorkspaceBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LocalWorkspaceBinding_organizationId_userId_localIdentityId_key"
  ON "LocalWorkspaceBinding"("organizationId", "userId", "localIdentityId");
CREATE INDEX "LocalWorkspaceBinding_organizationId_userId_revokedAt_idx"
  ON "LocalWorkspaceBinding"("organizationId", "userId", "revokedAt");
