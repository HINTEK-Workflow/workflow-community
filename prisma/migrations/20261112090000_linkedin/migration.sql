-- LinkedIn (2026-11-11): each company's own LinkedIn connection and a LinkedIn choice on its posts (Inlägg). Only additions:
-- one new table with its indexes and foreign key, and two columns on SocialPost (one nullable, one with a default); the old
-- app never reads them.
BEGIN;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "linkedInPostId" TEXT,
ADD COLUMN     "toLinkedIn" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LinkedInConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "clientSecretCipher" TEXT,
    "scopeSet" TEXT NOT NULL DEFAULT 'personal',
    "accessTokenCipher" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenCipher" TEXT,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "memberId" TEXT,
    "memberName" TEXT,
    "authorType" TEXT NOT NULL DEFAULT 'person',
    "authorId" TEXT,
    "authorName" TEXT,
    "organizations" JSONB,
    "status" TEXT NOT NULL DEFAULT 'unchecked',
    "statusMessage" TEXT,
    "checkedAt" TIMESTAMP(3),
    "publishingApproved" BOOLEAN NOT NULL DEFAULT false,
    "publishingApprovedAt" TIMESTAMP(3),
    "publishingApprovedById" TEXT,
    "pendingStateHash" TEXT,
    "pendingUserId" TEXT,
    "pendingExpiresAt" TIMESTAMP(3),
    "pendingScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedInConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInConnection_organizationId_key" ON "LinkedInConnection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInConnection_pendingStateHash_key" ON "LinkedInConnection"("pendingStateHash");

-- AddForeignKey
ALTER TABLE "LinkedInConnection" ADD CONSTRAINT "LinkedInConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
