-- Behörighetsstyrning (K2, 2026-11-28):
-- K2.3 Supportåtkomst med medgivande: SupportAccessGrant (företagets medgivande, 1 timme, 24 timmar eller 7 dygn) och
--      SupportAccessRead (vad supporten läste, visas för företagets admin). Utan en öppen rad finns ingen åtkomst.
-- K2.4 Granska behörigheter: påminnelsen varje kvartal (av från början) och senaste kvitteringen på WorkspaceSettings.
-- K2.5 Nyckel med minsta behörighet: maskinkällans nyckel kan begränsas till valda maskindelar (tom lista = ingen gräns).
--
-- Bara additivt: nya tabeller, nya kolumner med DEFAULT eller NULL, nya index och nya främmande nycklar. Ingen befintlig
-- rad skrivs om; den gamla appen läser och skriver aldrig de nya kolumnerna och tabellerna. Läsraden pekar på medgivandet
-- med en sammansatt nyckel ([grantId, organizationId]), så databasen själv vägrar en rad mot ett annat företags medgivande.

BEGIN;

-- AlterTable
ALTER TABLE "WorkspaceSettings" ADD COLUMN "accessReviewReminder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "accessReviewedAt" TIMESTAMP(3),
ADD COLUMN "accessReviewedById" TEXT;

-- AlterTable
ALTER TABLE "MachineSource" ADD COLUMN "allowedMachinePartIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "SupportAccessGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "hours" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "expiryLoggedAt" TIMESTAMP(3),

    CONSTRAINT "SupportAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAccessRead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "part" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAccessRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportAccessGrant_organizationId_expiresAt_idx" ON "SupportAccessGrant"("organizationId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportAccessGrant_id_organizationId_key" ON "SupportAccessGrant"("id", "organizationId");

-- CreateIndex
CREATE INDEX "SupportAccessRead_organizationId_createdAt_idx" ON "SupportAccessRead"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportAccessRead_grantId_idx" ON "SupportAccessRead"("grantId");

-- AddForeignKey
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAccessRead" ADD CONSTRAINT "SupportAccessRead_grantId_organizationId_fkey" FOREIGN KEY ("grantId", "organizationId") REFERENCES "SupportAccessGrant"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAccessRead" ADD CONSTRAINT "SupportAccessRead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Villkor ----------
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_hours_check" CHECK ("hours" IN (1, 24, 168));

COMMIT;
