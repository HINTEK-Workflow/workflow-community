-- Bakgrund bakom logotypen (2026-11-15): a post may draw its logo without the plate (Ingen); null keeps the plate (Ruta), so every
-- earlier post looks the same. Additive: one nullable column; the old app never reads it.
BEGIN;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "logoPlate" TEXT;

COMMIT;
