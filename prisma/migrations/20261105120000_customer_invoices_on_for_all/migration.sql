-- Fakturor are on for every company in Cloud (2026-11-05). A company without a row counts as on; every row that exists today
-- is switched on too, because no company has chosen off: it was the only state there was.
BEGIN;
ALTER TABLE "CustomerInvoiceSeries" ALTER COLUMN "enabled" SET DEFAULT TRUE;
UPDATE "CustomerInvoiceSeries" SET "enabled" = TRUE WHERE "enabled" = FALSE;
COMMIT;
