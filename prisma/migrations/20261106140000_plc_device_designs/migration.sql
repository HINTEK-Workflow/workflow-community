-- PLC-apparater: the product owner's designs of the simulator's devices (name, group, picture, terminal layout, a function from
-- the simulator's own list). Product-wide content like PdfTemplateOverride; no company's data. Only additions.
BEGIN;
CREATE TABLE "PlcDeviceDesign" (
    "key" TEXT NOT NULL,
    "draft" JSONB,
    "published" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlcDeviceDesign_pkey" PRIMARY KEY ("key")
);
COMMIT;
