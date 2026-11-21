-- Företagets moduler (0.39.0): the optional modules a company has turned off, by key (lib/workflow/modules.ts).
-- Additive: empty means everything on, so every existing company stays exactly as it is. Nothing is removed.
BEGIN;

ALTER TABLE "Organization" ADD COLUMN "disabledModules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

COMMIT;
