-- Förlopp och Avbryt för registerhämtningen (2026-10-18). Additive: three nullable columns on WholesaleRegisterSync,
-- no data is touched. runPages / runWritten = the running run's counters (set while it runs, emptied when it ends);
-- cancelRequestedAt = the product owner asked the running run to stop (the job checks between pages).
ALTER TABLE "WholesaleRegisterSync" ADD COLUMN "runPages" INTEGER;
ALTER TABLE "WholesaleRegisterSync" ADD COLUMN "runWritten" INTEGER;
ALTER TABLE "WholesaleRegisterSync" ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);
