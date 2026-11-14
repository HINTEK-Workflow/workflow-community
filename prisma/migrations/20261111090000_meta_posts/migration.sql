-- Facebook och Instagram (2026-11-10): each company's own Meta connection and its posts (Inlägg). Only additions: two new
-- tables with their indexes and foreign keys; the old app never reads them.
BEGIN;

-- CreateTable
CREATE TABLE "MetaConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "appId" TEXT,
    "appSecretCipher" TEXT,
    "userTokenCipher" TEXT,
    "userTokenExpiresAt" TIMESTAMP(3),
    "dataAccessExpiresAt" TIMESTAMP(3),
    "pageId" TEXT,
    "pageName" TEXT,
    "pageTokenCipher" TEXT,
    "instagramId" TEXT,
    "instagramUsername" TEXT,
    "pages" JSONB,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'unchecked',
    "statusMessage" TEXT,
    "checkedAt" TIMESTAMP(3),
    "publishingApproved" BOOLEAN NOT NULL DEFAULT false,
    "publishingApprovedAt" TIMESTAMP(3),
    "publishingApprovedById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "heading" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "caption" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "template" TEXT NOT NULL DEFAULT 'color',
    "toFacebook" BOOLEAN NOT NULL DEFAULT true,
    "toInstagram" BOOLEAN NOT NULL DEFAULT true,
    "facebookPostId" TEXT,
    "instagramMediaId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "lastError" TEXT,
    "testedAt" TIMESTAMP(3),
    "testResult" TEXT,
    "imageKeyHash" TEXT,
    "imageKeyExpiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetaConnection_organizationId_key" ON "MetaConnection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_imageKeyHash_key" ON "SocialPost"("imageKeyHash");

-- CreateIndex
CREATE INDEX "SocialPost_organizationId_createdAt_idx" ON "SocialPost"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_organizationId_source_sourceRef_key" ON "SocialPost"("organizationId", "source", "sourceRef");

-- AddForeignKey
ALTER TABLE "MetaConnection" ADD CONSTRAINT "MetaConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
