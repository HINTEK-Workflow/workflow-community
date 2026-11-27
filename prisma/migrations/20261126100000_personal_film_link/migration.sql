-- Personlig filmlänk (2026-11-26): one of the landing page's films sent to one person, with a short greeting clip first.
-- Only additions: one new table with its indexes, no foreign keys; the old app never reads it. Safe to run again; one transaction.
BEGIN;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PersonalFilmLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filmTitle" TEXT NOT NULL,
    "filmSrc" TEXT NOT NULL,
    "filmSmall" TEXT NOT NULL DEFAULT '',
    "filmSubtitles" TEXT NOT NULL DEFAULT '',
    "posterSrc" TEXT NOT NULL DEFAULT '',
    "greetingSrc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalFilmLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PersonalFilmLink_tokenHash_key" ON "PersonalFilmLink"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PersonalFilmLink_createdAt_idx" ON "PersonalFilmLink"("createdAt");

COMMIT;
