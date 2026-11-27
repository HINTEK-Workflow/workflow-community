-- PDF-mallar (2026-11-03, lib/pdf-templates): one new table for the product owner's changes to the documents' default
-- texts. Additive only: no existing table, column or row is touched. Without rows every document keeps its defaults.
BEGIN;

CREATE TABLE IF NOT EXISTS "PdfTemplateOverride" (
    "id" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "text" TEXT,
    "visible" BOOLEAN,
    "orderIndex" INTEGER,
    "basedOnVersion" TEXT NOT NULL,
    "basedOnText" TEXT,
    "updatedById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdfTemplateOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PdfTemplateOverride_documentType_blockId_key" ON "PdfTemplateOverride"("documentType", "blockId");

COMMIT;
