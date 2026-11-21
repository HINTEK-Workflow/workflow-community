-- Tavlor och skärmar, etapp 2 (2026-11-18, docs/beslut/tavlor-och-skarmar.md): playlists, the ways in without a sign-in (connected
-- screens and shared links, only hashes of their secrets), the screens and their pairing requests. Additive: four new tables; the
-- old app never reads them.
BEGIN;

-- CreateTable
CREATE TABLE "BoardPlaylist" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BoardPlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardAccess" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "boardId" TEXT,
    "playlistId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "codeHash" TEXT,
    "failedCodes" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Screen" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "placeName" TEXT NOT NULL DEFAULT '',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "deviceInfo" JSONB NOT NULL DEFAULT '{}',
    "lastSeenAt" TIMESTAMP(3),
    "lastNetworkHash" TEXT,
    "command" JSONB,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Screen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenPairing" (
    "id" TEXT NOT NULL,
    "userCodeHash" TEXT NOT NULL,
    "deviceSecretHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "requestInfo" JSONB NOT NULL DEFAULT '{}',
    "networkHash" TEXT,
    "organizationId" TEXT,
    "screenId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "lastPollAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenPairing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardPlaylist_organizationId_deletedAt_idx" ON "BoardPlaylist"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BoardPlaylist_id_organizationId_key" ON "BoardPlaylist"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardAccess_tokenHash_key" ON "BoardAccess"("tokenHash");

-- CreateIndex
CREATE INDEX "BoardAccess_organizationId_kind_idx" ON "BoardAccess"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "BoardAccess_id_organizationId_key" ON "BoardAccess"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Screen_accessId_key" ON "Screen"("accessId");

-- CreateIndex
CREATE INDEX "Screen_organizationId_status_idx" ON "Screen"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Screen_accessId_organizationId_key" ON "Screen"("accessId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreenPairing_userCodeHash_key" ON "ScreenPairing"("userCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "ScreenPairing_deviceSecretHash_key" ON "ScreenPairing"("deviceSecretHash");

-- CreateIndex
CREATE INDEX "ScreenPairing_expiresAt_idx" ON "ScreenPairing"("expiresAt");

-- AddForeignKey
ALTER TABLE "BoardPlaylist" ADD CONSTRAINT "BoardPlaylist_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardAccess" ADD CONSTRAINT "BoardAccess_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_accessId_organizationId_fkey" FOREIGN KEY ("accessId", "organizationId") REFERENCES "BoardAccess"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
