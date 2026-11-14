-- Fler mallar och loggor (2026-11-13): the company may upload its logo in up to three more variants (for a dark background, for a
-- light background, and in black), stored like the logo itself; a post chooses the variant (automatic by default) and its size.
-- Additive: columns with defaults or null; the old app never reads them.
BEGIN;

-- AlterTable
ALTER TABLE "WorkspaceSettings" ADD COLUMN     "logoOnDarkPath" TEXT,
ADD COLUMN     "logoOnLightPath" TEXT,
ADD COLUMN     "logoBlackPath" TEXT;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "logoVariant" TEXT NOT NULL DEFAULT 'auto',
ADD COLUMN     "logoSize" TEXT NOT NULL DEFAULT 'medium';

COMMIT;
