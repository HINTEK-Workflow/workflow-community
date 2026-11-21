-- "Vem får logga in" (2026-10-06): Alla / Endast / Alla utom blockerade, with the address and domain lists.
-- Additive and idempotent; empty = not chosen yet, so the older rule ("Tillåt nya konton" and PILOT_ACCESS_EMAILS) applies.
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "loginAccess" JSONB NOT NULL DEFAULT '{}';
