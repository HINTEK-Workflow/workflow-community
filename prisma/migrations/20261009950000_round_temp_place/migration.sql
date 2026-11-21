-- Tillfällig plats på en rond (2026-10-08): "Upprepa kontrollen" plans a round from a protocol, and the
-- protocol's temporary place (address, postcode, city, optional pin) now follows into the round and from there into
-- every protocol started from it. Backward compatible: one nullable JSON column, no default value and no backfill;
-- a round without a temporary place keeps NULL. Tenant relations and triggers are untouched.

-- AlterTable
ALTER TABLE "FormSchedule" ADD COLUMN "tempPlace" JSONB;
