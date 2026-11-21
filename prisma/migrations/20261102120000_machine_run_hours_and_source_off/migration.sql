-- Maskiner (2026-11-02). No row changes and nothing is removed.
-- 1. A new machine source starts on Av: only the column default moves, so every existing source keeps its own choice.
-- 2. Run hours from a PLC: a signal can feed its machine part's hours; the part says where the value came from and holds a
--    machine value it did not use (lower, or a jump larger than the clock allows). Rules: lib/machine/run-hours.ts.
BEGIN;

ALTER TABLE "MachineSource" ALTER COLUMN "alarmMode" SET DEFAULT 'off';

ALTER TABLE "MachineSignal" ADD COLUMN "runHoursFeed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "MachinePart" ADD COLUMN "runHoursOrigin" TEXT;
ALTER TABLE "MachinePart" ADD COLUMN "runHoursHeld" DOUBLE PRECISION;
ALTER TABLE "MachinePart" ADD COLUMN "runHoursHeldAt" TIMESTAMP(3);
ALTER TABLE "MachinePart" ADD COLUMN "runHoursHeldReason" TEXT;

-- 3. A profile's record id is remembered with the prefix id: (lib/machine/raw-store.ts); the check widens, old rows still pass.
ALTER TABLE "MachineRawDedupe" DROP CONSTRAINT "MachineRawDedupe_hash_check";
ALTER TABLE "MachineRawDedupe" ADD CONSTRAINT "MachineRawDedupe_hash_check" CHECK ("hash" ~ '^(id:)?[0-9a-f]{64}$');

COMMIT;
