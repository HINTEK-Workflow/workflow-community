-- YouTube (2026-11-20): each company's own YouTube connection and its films (Mer > Webb och inlägg > Filmer). Only additions:
-- two new tables with their indexes and foreign keys; the old app never reads them.
BEGIN;

-- CreateTable
CREATE TABLE "YouTubeConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "clientSecretCipher" TEXT,
    "accessTokenCipher" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenCipher" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channels" JSONB,
    "channelId" TEXT,
    "channelName" TEXT,
    "playlists" JSONB,
    "categories" JSONB,
    "status" TEXT NOT NULL DEFAULT 'unchecked',
    "statusMessage" TEXT,
    "checkedAt" TIMESTAMP(3),
    "privateLocked" BOOLEAN NOT NULL DEFAULT false,
    "privateLockedAt" TIMESTAMP(3),
    "publishingApproved" BOOLEAN NOT NULL DEFAULT false,
    "publishingApprovedAt" TIMESTAMP(3),
    "publishingApprovedById" TEXT,
    "pendingStateHash" TEXT,
    "pendingVerifierCipher" TEXT,
    "pendingUserId" TEXT,
    "pendingExpiresAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YouTubeConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeVideo" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categoryId" TEXT,
    "privacy" TEXT NOT NULL DEFAULT 'private',
    "madeForKids" BOOLEAN,
    "playlistId" TEXT,
    "playlistName" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT,
    "fileType" TEXT,
    "fileSize" BIGINT,
    "fileReceived" BIGINT NOT NULL DEFAULT 0,
    "fileUpload" TEXT,
    "thumbnailKey" TEXT,
    "thumbnailSource" TEXT,
    "thumbnailUpdatedAt" TIMESTAMP(3),
    "youtubeId" TEXT,
    "youtubePrivacy" TEXT,
    "youtubeChannelId" TEXT,
    "thumbnailPending" BOOLEAN NOT NULL DEFAULT false,
    "playlistPending" BOOLEAN NOT NULL DEFAULT false,
    "uploadSessionCipher" TEXT,
    "uploadOffset" BIGINT NOT NULL DEFAULT 0,
    "uploadAttempts" INTEGER NOT NULL DEFAULT 0,
    "uploadNextAt" TIMESTAMP(3),
    "uploadLockedUntil" TIMESTAMP(3),
    "uploadStartedAt" TIMESTAMP(3),
    "uploadById" TEXT,
    "uploadError" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YouTubeVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeConnection_organizationId_key" ON "YouTubeConnection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeConnection_pendingStateHash_key" ON "YouTubeConnection"("pendingStateHash");

-- CreateIndex
CREATE INDEX "YouTubeVideo_organizationId_createdAt_idx" ON "YouTubeVideo"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "YouTubeVideo_status_uploadNextAt_idx" ON "YouTubeVideo"("status", "uploadNextAt");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeVideo_id_organizationId_key" ON "YouTubeVideo"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "YouTubeConnection" ADD CONSTRAINT "YouTubeConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeVideo" ADD CONSTRAINT "YouTubeVideo_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
